// pino-roll ships without type declarations. Only the options this project uses are listed.
declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';

  interface PinoRollOptions {
    file: string | (() => string);
    size?: number | string;
    frequency?: 'daily' | 'hourly' | number;
    extension?: string;
    symlink?: boolean;
    limit?: { count?: number; removeOtherLogFiles?: boolean };
    dateFormat?: string;
    mkdir?: boolean;
    sync?: boolean;
  }

  export default function pinoRoll(options: PinoRollOptions): Promise<DestinationStream>;
}
