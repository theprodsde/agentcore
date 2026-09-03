import { WebClient } from '@slack/web-api';
import { logger } from './logger.js';

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

export async function sendSlackResponse(channel: string, thread_ts: string | undefined, blocks: any[], text: string) {
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
