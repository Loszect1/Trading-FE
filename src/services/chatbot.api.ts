import { API_REQUEST_TIMEOUT_MS, httpClient, normalizeError } from "@/services/http-client";

export type ChatbotRole = "user" | "assistant";

export interface ChatbotHistoryMessage {
  role: ChatbotRole;
  content: string;
}

interface ChatbotResponse {
  success: boolean;
  data?: {
    reply?: string;
  };
}

export async function sendChatbotMessage(message: string, history: ChatbotHistoryMessage[]): Promise<string> {
  try {
    const response = await httpClient.post<ChatbotResponse>(
      "/ai/chat",
      {
        message,
        history,
      },
      {
        timeout: API_REQUEST_TIMEOUT_MS,
      },
    );
    const reply = response.data.data?.reply?.trim();
    if (!reply) {
      throw new Error("Chatbot returned an empty reply");
    }
    return reply;
  } catch (error) {
    throw normalizeError(error);
  }
}
