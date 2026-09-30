export interface PartnerAppOptions {
  envelopeUrl: string;
  apiKey: string;
  envelopeId?: string;
  webhookSecret?: string;
  actorId?: string;
}
export interface PartnerApp {
  state: {
    origin: string;
    webhookSecret: string;
    envelopeId: string | undefined;
    sessions: string[];
    events: Map<string, { id: string; type: string; data: { envelopeId: string } }>;
  };
  setWebhookSecret(secret: string): void;
  listen(options?: { port?: number; host?: string; origin?: string }): Promise<string>;
  close(): Promise<void>;
}
export function createPartnerApp(options: PartnerAppOptions): PartnerApp;
