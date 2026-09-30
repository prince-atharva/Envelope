import { createServer, type Server, type Socket } from 'node:net';

/** What an EICAR-style test file is recognised by. The real EICAR string is not written out here. */
export const INFECTED_MARKER = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE';

export type FakeClamdMode = 'normal' | 'error' | 'hang' | 'close';

/**
 * A real local TCP server that speaks the part of the clamd protocol the API
 * uses (INSTREAM: `zINSTREAM\0`, length-prefixed chunks, a zero length, one
 * NUL-terminated reply). ClamAV's own signature database needs internet to
 * download, which tests do not have, so this stands in for the daemon the way
 * the webhook tests' local HTTP receiver stands in for a partner (AGENTS §6).
 */
export class FakeClamd {
  mode: FakeClamdMode = 'normal';
  /** Every file it was sent, whole, in order. */
  readonly scans: Buffer[] = [];
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  /** Starts listening on a free port and returns it. */
  start(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.serve(socket));
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        this.server = server;
        resolve((server.address() as { port: number }).port);
      });
    });
  }

  stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }

  private serve(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = Buffer.alloc(0);
    let started = false;
    const parts: Buffer[] = [];

    socket.on('data', (data) => {
      if (this.mode === 'close') return void socket.destroy();
      buffer = Buffer.concat([buffer, data]);
      if (!started) {
        if (buffer.length < 10) return;
        if (buffer.subarray(0, 10).toString() !== 'zINSTREAM\0') return void socket.destroy();
        buffer = buffer.subarray(10);
        started = true;
      }
      for (;;) {
        if (buffer.length < 4) return;
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          const file = Buffer.concat(parts);
          this.scans.push(file);
          return void this.reply(socket, file);
        }
        if (buffer.length < 4 + length) return;
        parts.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
  }

  private reply(socket: Socket, file: Buffer): void {
    if (this.mode === 'hang') return;
    if (this.mode === 'error') return void socket.end('INSTREAM size limit exceeded. ERROR\0');
    socket.end(
      file.includes(INFECTED_MARKER) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0',
    );
  }
}
