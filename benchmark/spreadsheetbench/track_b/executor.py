"""
Track B: ServalSheets MCP Instruction Executor.

For each SpreadsheetBench instruction:
1. Import input.xlsx into Google Sheets via sheets_composite.import_xlsx (MCP)
2. Give Claude the instruction + all 25 ServalSheets MCP tools
3. Claude uses MCP tools to manipulate the live spreadsheet
4. Export result as XLSX via sheets_composite.export_xlsx (MCP)
5. Compare against answer.xlsx using official SpreadsheetBench evaluation logic

Everything goes through the MCP server — no direct Google API calls needed.
"""

import os
import sys
import json
import time
import base64
import struct
import subprocess
import tempfile
import threading
import traceback
from pathlib import Path
from typing import Optional


# ============================================================================
# MCP STDIO Client — communicates with ServalSheets via JSON-RPC over STDIO
# ============================================================================

class McpStdioClient:
    """
    Manages a ServalSheets MCP server subprocess and sends JSON-RPC requests
    over STDIO (stdin/stdout).

    MCP uses newline-delimited JSON-RPC 2.0 messages.
    """

    def __init__(self, servalsheets_path, env_overrides=None):
        self.servalsheets_path = Path(servalsheets_path)
        self.process = None
        self.request_id = 0
        self._lock = threading.Lock()
        self._read_buffer = ""
        self._response_map = {}
        self._reader_thread = None
        self._running = False
        self.env_overrides = env_overrides or {}

    def start(self):
        """Spawn the ServalSheets MCP server as a child process."""
        cli_path = self.servalsheets_path / "dist" / "cli.js"
        if not cli_path.exists():
            raise FileNotFoundError(
                f"ServalSheets not built. Run: cd {self.servalsheets_path} && npm run build"
            )

        env = os.environ.copy()
        env.update(self.env_overrides)
        # Ensure STDIO mode
        env["MCP_TRANSPORT"] = "stdio"

        self.process = subprocess.Popen(
            ["node", str(cli_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(self.servalsheets_path),
            env=env,
            bufsize=0,  # Unbuffered for real-time communication
        )

        self._running = True
        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader_thread.start()

        # Give server a moment to initialize
        time.sleep(1)

        # Send MCP initialize request
        init_result = self.send_request("initialize", {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {
                "name": "spreadsheetbench-harness",
                "version": "1.0.0",
            }
        })

        # Send initialized notification
        self.send_notification("notifications/initialized", {})

        return init_result

    def stop(self):
        """Gracefully shut down the MCP server."""
        self._running = False
        if self.process:
            try:
                self.process.stdin.close()
                self.process.wait(timeout=5)
            except Exception:
                self.process.kill()
            self.process = None

    def _read_stdout(self):
        """Background thread that reads JSON-RPC responses from server stdout."""
        while self._running and self.process and self.process.stdout:
            try:
                line = self.process.stdout.readline()
                if not line:
                    break
                line = line.decode('utf-8').strip()
                if not line:
                    continue

                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    # Could be a log line, skip
                    continue

                # Match response to request by ID
                msg_id = msg.get("id")
                if msg_id is not None:
                    self._response_map[msg_id] = msg

            except Exception:
                if self._running:
                    continue
                break

    def send_request(self, method, params=None, timeout=30):
        """Send a JSON-RPC request and wait for the response."""
        with self._lock:
            self.request_id += 1
            req_id = self.request_id

        request = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": method,
        }
        if params is not None:
            request["params"] = params

        # Send request
        msg = json.dumps(request) + "\n"
        self.process.stdin.write(msg.encode('utf-8'))
        self.process.stdin.flush()

        # Wait for response
        start = time.time()
        while time.time() - start < timeout:
            if req_id in self._response_map:
                response = self._response_map.pop(req_id)
                if "error" in response:
                    raise McpError(response["error"])
                return response.get("result")
            time.sleep(0.05)

        raise TimeoutError(f"MCP request {method} timed out after {timeout}s")

    def send_notification(self, method, params=None):
        """Send a JSON-RPC notification (no response expected)."""
        notification = {
            "jsonrpc": "2.0",
            "method": method,
        }
        if params is not None:
            notification["params"] = params

        msg = json.dumps(notification) + "\n"
        self.process.stdin.write(msg.encode('utf-8'))
        self.process.stdin.flush()

    def call_tool(self, tool_name, arguments, timeout=60):
        """
        Call an MCP tool and return the result.

        This is the core method used by both the executor and Claude's tool calls.
        """
        result = self.send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments,
        }, timeout=timeout)

        # Extract text content from MCP CallToolResult
        if result and "content" in result:
            for block in result["content"]:
                if block.get("type") == "text":
                    try:
                        return json.loads(block["text"])
                    except (json.JSONDecodeError, KeyError):
                        return block.get("text", "")
        return result

    def list_tools(self):
        """Get the list of available tools from the server."""
        result = self.send_request("tools/list", {})
        return result.get("tools", []) if result else []


class McpError(Exception):
    """Error returned by MCP server."""
    def __init__(self, error_data):
        self.code = error_data.get("code", -1)
        self.message = error_data.get("message", "Unknown MCP error")
        super().__init__(f"MCP Error {self.code}: {self.message}")


# ============================================================================
# Anthropic Client Helper
# ============================================================================

_anthropic_client = None

def _get_anthropic_client(api_key):
    global _anthropic_client
    if _anthropic_client is None:
        from anthropic import Anthropic
        _anthropic_client = Anthropic(api_key=api_key)
    return _anthropic_client


# ============================================================================
# Main Executor
# ============================================================================

class McpInstructionExecutor:
    """
    Execute SpreadsheetBench instructions using ServalSheets MCP server.

    Everything goes through MCP — upload, manipulation, download.
    """

    def __init__(self, api_key, model, servalsheets_path, env_overrides=None):
        self.api_key = api_key
        self.model = model
        self.servalsheets_path = Path(servalsheets_path)

        # Start MCP server
        print("Starting ServalSheets MCP server...")
        self.mcp = McpStdioClient(servalsheets_path, env_overrides=env_overrides)
        init_result = self.mcp.start()
        print(f"MCP server initialized: {json.dumps(init_result, indent=2)[:200]}")

        # Load tool definitions for Claude
        self.tools_for_claude = self._build_claude_tools()
        print(f"Loaded {len(self.tools_for_claude)} tools for Claude")

    def _build_claude_tools(self):
        """
        Fetch tool schemas from the running MCP server and convert to
        Anthropic's tool format for Claude's tool_use.
        """
        mcp_tools = self.mcp.list_tools()
        claude_tools = []

        for tool in mcp_tools:
            claude_tools.append({
                "name": tool["name"],
                "description": tool.get("description", ""),
                "input_schema": tool.get("inputSchema", {}),
            })

        return claude_tools

    def shutdown(self):
        """Stop the MCP server."""
        if self.mcp:
            self.mcp.stop()

    def _import_xlsx(self, xlsx_path, title=None):
        """
        Import an XLSX file into Google Sheets via sheets_composite.import_xlsx.

        Returns: spreadsheet ID
        """
        with open(xlsx_path, 'rb') as f:
            file_bytes = f.read()
        file_b64 = base64.b64encode(file_bytes).decode('utf-8')

        result = self.mcp.call_tool("sheets_composite", {
            "request": {
                "action": "import_xlsx",
                "fileContent": file_b64,
                "title": title or f"SpreadsheetBench_{Path(xlsx_path).stem}",
            }
        }, timeout=120)

        if isinstance(result, dict):
            resp = result.get("response", result)
            if resp.get("success"):
                return resp["spreadsheetId"]
            else:
                raise RuntimeError(f"import_xlsx failed: {resp.get('error', resp)}")
        raise RuntimeError(f"Unexpected import_xlsx result: {result}")

    def _export_xlsx(self, spreadsheet_id, output_path):
        """
        Export a Google Sheet as XLSX via sheets_composite.export_xlsx.

        Writes the file to output_path.
        """
        result = self.mcp.call_tool("sheets_composite", {
            "request": {
                "action": "export_xlsx",
                "spreadsheetId": spreadsheet_id,
            }
        }, timeout=120)

        if isinstance(result, dict):
            resp = result.get("response", result)
            if resp.get("success") and resp.get("fileContent"):
                file_bytes = base64.b64decode(resp["fileContent"])
                with open(output_path, 'wb') as f:
                    f.write(file_bytes)
                return
            else:
                raise RuntimeError(f"export_xlsx failed: {resp.get('error', resp)}")
        raise RuntimeError(f"Unexpected export_xlsx result: {result}")

    def _delete_spreadsheet(self, spreadsheet_id):
        """Delete a spreadsheet via sheets_core.delete (cleanup)."""
        try:
            self.mcp.call_tool("sheets_core", {
                "request": {
                    "action": "delete",
                    "spreadsheetId": spreadsheet_id,
                }
            }, timeout=30)
        except Exception:
            pass  # Non-critical cleanup

    def _read_spreadsheet_preview(self, spreadsheet_id):
        """
        Read the first rows of each sheet to build a content preview
        (matching the SpreadsheetBench prompt format).
        """
        try:
            # Get spreadsheet metadata
            meta_result = self.mcp.call_tool("sheets_core", {
                "request": {
                    "action": "get",
                    "spreadsheetId": spreadsheet_id,
                }
            }, timeout=30)

            resp = meta_result.get("response", meta_result) if isinstance(meta_result, dict) else {}
            sheets = resp.get("sheets", [])
            sheet_names = [s.get("title", f"Sheet{i+1}") for i, s in enumerate(sheets)]

            if not sheet_names:
                sheet_names = ["Sheet1"]

            preview = ""
            for sheet_name in sheet_names[:5]:  # Max 5 sheets
                try:
                    read_result = self.mcp.call_tool("sheets_data", {
                        "request": {
                            "action": "read",
                            "spreadsheetId": spreadsheet_id,
                            "range": f"'{sheet_name}'!A1:Z10",
                        }
                    }, timeout=30)

                    read_resp = read_result.get("response", read_result) if isinstance(read_result, dict) else {}
                    values = read_resp.get("values", [])

                    preview += f"Sheet Name: {sheet_name}\n"
                    for row in values[:6]:  # First 6 rows
                        preview += "\t".join(str(c) if c is not None else "" for c in row) + "\n"
                    preview += "-" * 50 + "\n"

                except Exception:
                    preview += f"Sheet Name: {sheet_name}\n(could not read)\n"
                    preview += "-" * 50 + "\n"

            return preview

        except Exception as e:
            return f"(Could not read spreadsheet: {e})"

    def _run_agentic_loop(self, instruction, spreadsheet_id, answer_position,
                           instruction_type, spreadsheet_preview, cost_tracker):
        """
        Run Claude with ServalSheets MCP tools in an agentic loop.

        Claude reads the spreadsheet, plans, and executes tool calls until
        it determines the task is complete.
        """
        client = _get_anthropic_client(self.api_key)

        system_prompt = f"""You are a spreadsheet expert using ServalSheets MCP tools to manipulate a Google Sheet.

TASK: Complete the spreadsheet manipulation described below.

SPREADSHEET ID: {spreadsheet_id}

RULES:
1. Use sheets_data with action "read" to examine the spreadsheet data first.
2. Only modify cells within the answer_position: {answer_position}
3. The instruction_type is: {instruction_type}
   - Cell-Level Manipulation: write specific cell values
   - Sheet-Level Manipulation: you may need to write to a range of cells
4. When writing data, use sheets_data with action "write".
5. For formulas, write them as string values starting with "=".
6. For computed values (SUM, AVERAGE, counts, lookups, etc.), compute the result and write the value directly.
7. Always include the spreadsheetId in every tool call.
8. When done, respond with a text message saying "TASK COMPLETE".

IMPORTANT: The request envelope format is:
  {{"request": {{"action": "...", "spreadsheetId": "...", ...}}}}

Available data about the spreadsheet:
{spreadsheet_preview}
"""

        user_message = f"""Complete this spreadsheet manipulation task:

{instruction}

Spreadsheet ID: {spreadsheet_id}
Answer position (cells to modify): {answer_position}
Instruction type: {instruction_type}

Start by reading the relevant data, then execute the necessary operations."""

        messages = [{"role": "user", "content": user_message}]
        max_iterations = 25
        tool_calls_made = []

        for iteration in range(max_iterations):
            try:
                response = client.messages.create(
                    model=self.model,
                    max_tokens=8192,
                    system=system_prompt,
                    messages=messages,
                    tools=self.tools_for_claude,
                )
            except Exception as e:
                print(f"    LLM call failed at iteration {iteration}: {e}")
                break

            cost_tracker.record(tokens={
                "input": response.usage.input_tokens,
                "output": response.usage.output_tokens,
            })

            # Check if Claude is done
            has_tool_use = any(
                getattr(block, 'type', None) == "tool_use"
                for block in response.content
            )

            if not has_tool_use:
                # Claude is done — extract any final text
                break

            if response.stop_reason == "end_turn" and not has_tool_use:
                break

            # Append assistant message
            messages.append({"role": "assistant", "content": response.content})

            # Execute each tool call via MCP
            tool_results = []
            for block in response.content:
                if getattr(block, 'type', None) == "tool_use":
                    tool_name = block.name
                    tool_input = block.input

                    try:
                        mcp_result = self.mcp.call_tool(tool_name, tool_input, timeout=60)
                        result_text = json.dumps(mcp_result, default=str)
                    except Exception as e:
                        result_text = json.dumps({
                            "error": str(e),
                            "hint": "Check the action name and parameters format."
                        })

                    tool_calls_made.append({
                        "tool": tool_name,
                        "action": tool_input.get("request", {}).get("action", "unknown")
                                  if isinstance(tool_input, dict) else "unknown",
                        "iteration": iteration,
                    })

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_text[:10000],  # Truncate very large results
                    })

            messages.append({"role": "user", "content": tool_results})

        return tool_calls_made

    def execute_instruction(self, data, dataset_path, cost_tracker):
        """
        Execute a complete SpreadsheetBench instruction via ServalSheets MCP.

        Following the official protocol:
        - Generate a solution using test case #1
        - Replay on test cases #2 and #3

        For MCP, "replay" means re-running the same agentic loop with different
        input data (since MCP tool calls are state-dependent, not code-replay).

        Returns evaluation result dict matching official format.
        """
        task_id = data['id']
        start_time = time.time()
        test_case_results = []
        test_case_details = []
        all_tool_calls = []

        for tc_idx in range(3):
            tc_start = time.time()
            input_path = str(
                Path(dataset_path) / "spreadsheet" / str(task_id) /
                f"{tc_idx + 1}_{task_id}_input.xlsx"
            )
            answer_path = str(
                Path(dataset_path) / "spreadsheet" / str(task_id) /
                f"{tc_idx + 1}_{task_id}_answer.xlsx"
            )

            spreadsheet_id = None
            output_path = None

            try:
                # 1. Import input.xlsx via MCP
                print(f"    TC{tc_idx+1}: Importing {Path(input_path).name}...")
                spreadsheet_id = self._import_xlsx(
                    input_path,
                    title=f"Bench_{task_id}_TC{tc_idx+1}"
                )
                print(f"    TC{tc_idx+1}: Created spreadsheet {spreadsheet_id}")

                # 2. Read spreadsheet preview for Claude's context
                preview = self._read_spreadsheet_preview(spreadsheet_id)

                # 3. Run agentic loop — Claude uses MCP tools
                print(f"    TC{tc_idx+1}: Running agentic loop...")
                tool_calls = self._run_agentic_loop(
                    instruction=data['instruction'],
                    spreadsheet_id=spreadsheet_id,
                    answer_position=data['answer_position'],
                    instruction_type=data['instruction_type'],
                    spreadsheet_preview=preview,
                    cost_tracker=cost_tracker,
                )
                all_tool_calls.extend(tool_calls)
                print(f"    TC{tc_idx+1}: {len(tool_calls)} tool calls made")

                # 4. Export result as XLSX via MCP
                with tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False) as f:
                    output_path = f.name

                self._export_xlsx(spreadsheet_id, output_path)

                # 5. Compare using official evaluation logic
                sys.path.insert(0, str(Path(__file__).parent.parent / "evaluation"))
                from compare import compare_workbooks
                result, msg, mismatches = compare_workbooks(
                    answer_path, output_path,
                    data['instruction_type'],
                    data['answer_position'],
                )

                test_case_results.append(int(result))
                test_case_details.append({
                    'test_case': tc_idx + 1,
                    'passed': result,
                    'message': msg,
                    'tool_calls': len(tool_calls),
                    'duration_sec': round(time.time() - tc_start, 1),
                })

                if result:
                    print(f"    TC{tc_idx+1}: PASSED")
                else:
                    print(f"    TC{tc_idx+1}: FAILED — {msg[:100]}")

            except Exception as e:
                test_case_results.append(0)
                test_case_details.append({
                    'test_case': tc_idx + 1,
                    'passed': False,
                    'message': str(e),
                    'traceback': traceback.format_exc(),
                    'duration_sec': round(time.time() - tc_start, 1),
                })
                print(f"    TC{tc_idx+1}: ERROR — {e}")

            finally:
                # Cleanup
                if output_path and os.path.exists(output_path):
                    os.unlink(output_path)
                if spreadsheet_id:
                    self._delete_spreadsheet(spreadsheet_id)

        soft = test_case_results.count(1) / len(test_case_results) if test_case_results else 0
        hard = 0 if 0 in test_case_results else 1

        return {
            'id': task_id,
            'status': 'completed',
            'duration_sec': round(time.time() - start_time, 1),
            'test_case_results': test_case_results,
            'soft_restriction': soft,
            'hard_restriction': hard,
            'details': test_case_details,
            'tool_calls_total': len(all_tool_calls),
            'tool_call_breakdown': all_tool_calls,
        }
