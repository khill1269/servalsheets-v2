
        export function handler(req: any) {
          // Pattern says: use execute
          // Security says: validate input first
          return process(req.body);
        }
        