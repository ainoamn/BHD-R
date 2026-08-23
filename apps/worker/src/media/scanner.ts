import net from 'node:net';
import { once } from 'node:events';

export type ScanResult =
  | { status: 'clean' }
  | { status: 'infected'; signature: string }
  | { status: 'unavailable'; reason: string };

export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

export class ClamAvScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 15_000,
  ) {}

  async scan(bytes: Uint8Array): Promise<ScanResult> {
    const socket = net.createConnection({ host: this.host, port: this.port });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => socket.destroy(new Error('ClamAV timeout')), this.timeoutMs);
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));

    try {
      await once(socket, 'connect');
      socket.write('zINSTREAM\0');
      const buffer = Buffer.from(bytes);
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
      await once(socket, 'close');
      const response = Buffer.concat(chunks).toString('utf8').replaceAll('\0', '').trim();
      if (response.endsWith('OK')) return { status: 'clean' };
      const found = response.match(/stream:\s+(.+)\s+FOUND$/);
      if (found?.[1]) return { status: 'infected', signature: found[1] };
      return { status: 'unavailable', reason: 'Unexpected scanner response' };
    } catch (error) {
      socket.destroy();
      return {
        status: 'unavailable',
        reason: error instanceof Error ? error.message : 'Scanner unavailable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class DisabledScanner implements MalwareScanner {
  async scan(): Promise<ScanResult> {
    return { status: 'unavailable', reason: 'Scanning disabled by configuration' };
  }
}
