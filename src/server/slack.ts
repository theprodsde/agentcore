import crypto from 'crypto';
import { WebClient, type KnownBlock } from '@slack/web-api';
import { logger } from './logger.js';

const SLACK_SIGNATURE_MAX_AGE_S = 60 * 5;

/**
 * Verifies a Slack request signature (v0 scheme) against the raw request body.
 * Rejects requests older than 5 minutes to prevent replay attacks.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string | undefined,
  rawBody: string | Buffer,
  signature: string | undefined
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SLACK_SIGNATURE_MAX_AGE_S) return false;

  const base = `v0:${timestamp}:${rawBody.toString()}`;
  const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

let slackClient: WebClient | null = null;

export function getSlackClient() {
  if (slackClient) return slackClient;
  
  if (process.env.SLACK_BOT_TOKEN) {
    slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
    logger.info("Initialized Slack WebClient");
  } else {
    logger.warn("No SLACK_BOT_TOKEN found, Slack messaging will be mocked");
  }
  return slackClient;
}

export async function sendSlackResponse(channel: string, thread_ts: string | undefined, blocks: KnownBlock[], text: string) {
  const client = getSlackClient();
  if (!client) {
    logger.info({ channel, thread_ts, blocks, text }, "Mock Slack message sent. (To enable real Slack, provide SLACK_BOT_TOKEN)");
    return;
  }
  
  try {
    await client.chat.postMessage({
      channel,
      thread_ts,
      blocks,
      text,
    });
    logger.info({ channel }, "Sent real Slack message");
  } catch (error) {
    logger.error({ err: error, channel }, "Failed to send Slack message");
  }
}
