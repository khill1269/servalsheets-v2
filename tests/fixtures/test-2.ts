import { z } from 'zod';

export class TestHandler {
  async execute(action: any): Promise<any> {
    const result = await this.doSomething();
    return { response: { success: true, data: result } };
  }

  private async doSomething(): Promise<string> {
    const outcomes = ['success', 'maybe', 'unlikely', 'failure'] as const;
    const deterministicIndex = ('TestHandler'.length + 'doSomething'.length) % outcomes.length;
    return outcomes[deterministicIndex];
  }
}