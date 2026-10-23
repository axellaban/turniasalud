import "server-only";
import { channelForChat } from "./messaging-settings";
import { telegramSendText, telegramSendVoice } from "./telegram";
import { wahaSendText, wahaSendVoice } from "./waha";

export async function sendChatText(chatId: string, text: string): Promise<void> {
  if (channelForChat(chatId) === "telegram") await telegramSendText(chatId, text);
  else await wahaSendText(chatId, text);
}

export async function sendChatVoice(chatId: string, audio: Buffer): Promise<void> {
  if (channelForChat(chatId) === "telegram") await telegramSendVoice(chatId, audio);
  else await wahaSendVoice(chatId, audio);
}
