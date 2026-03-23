#!/usr/bin/env python3
"""
Interactive Google OAuth setup for SpreadsheetBench Track B.

Starts the ServalSheets MCP server, initiates OAuth login,
and helps you complete the authentication flow.

Usage:
    python3 auth_setup.py
"""

import sys
import json
import os
from pathlib import Path

# Load .env
REPO_ROOT = Path(__file__).parent.parent.parent.resolve()
env_file = REPO_ROOT / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, val = line.partition('=')
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and val and key not in os.environ:
                    os.environ[key] = val

sys.path.insert(0, str(Path(__file__).parent))
from track_b.executor import McpStdioClient

serval_path = str(REPO_ROOT)
env_overrides = {}
token_store = REPO_ROOT / ".secrets" / "servalsheets.tokens.enc"
if token_store.exists():
    env_overrides["GOOGLE_TOKEN_STORE_PATH"] = str(token_store)

print("Starting ServalSheets MCP server...")
client = McpStdioClient(serval_path, env_overrides=env_overrides)

try:
    client.start()
    print("Server started.\n")

    # Check current status
    result = client.call_tool("sheets_auth", {
        "request": {"action": "status"}
    }, timeout=15)

    resp = result.get("response", result) if isinstance(result, dict) else {}
    if resp.get("authenticated"):
        print("✅ Already authenticated!")
        print(f"   Auth type: {resp.get('authType', '?')}")
        print("\nYou can run the benchmark now:")
        print("   ./run_track_b.sh --limit 5")
        sys.exit(0)

    print("Not authenticated. Initiating OAuth login flow...\n")

    # Start login
    try:
        login_result = client.call_tool("sheets_auth", {
            "request": {"action": "login"}
        }, timeout=30)

        login_resp = login_result.get("response", login_result) if isinstance(login_result, dict) else {}
        auth_url = login_resp.get("authUrl", "")

        if auth_url:
            print("=" * 60)
            print("  Open this URL in your browser to authenticate:")
            print("=" * 60)
            print(f"\n{auth_url}\n")
            print("=" * 60)
            print("\nAfter granting access, you'll get an authorization code.")
            code = input("\nPaste the authorization code here: ").strip()

            if code:
                # Send callback
                callback_result = client.call_tool("sheets_auth", {
                    "request": {
                        "action": "callback",
                        "code": code,
                        "state": login_resp.get("state", ""),
                    }
                }, timeout=30)

                cb_resp = callback_result.get("response", callback_result) if isinstance(callback_result, dict) else {}
                if cb_resp.get("success"):
                    print("\n✅ Authentication successful!")
                    print("You can now run the benchmark:")
                    print("   ./run_track_b.sh --limit 5")
                else:
                    print(f"\n❌ Callback failed: {cb_resp}")
            else:
                print("No code provided. Exiting.")
        else:
            print(f"Login response: {json.dumps(login_resp, indent=2)[:500]}")
            print("\nCouldn't get an auth URL. Check your OAuth client credentials in .env")

    except Exception as e:
        print(f"Login error: {e}")
        print("\nThe login action may require MCP elicitation support.")
        print("Try authenticating directly via the ServalSheets CLI:")
        print(f"   cd {serval_path}")
        print("   node dist/cli.js")
        print("   (then use sheets_auth login from an MCP client)")

finally:
    client.stop()
