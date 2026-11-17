import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/messages.json", import.meta.url));
let operationQueue = Promise.resolve();

async function readMessages() {
  try {
    const contents = await readFile(dataFile, "utf8");
    const messages = JSON.parse(contents);
    if (!Array.isArray(messages)) {
      throw new Error("The messages data file must contain a JSON array.");
    }
    return messages;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeMessages(messages) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `messages.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(messages, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write local chat messages and clean up its temporary file.");
    }
    throw error;
  }
}

function withMessages(operation) {
  const result = operationQueue.then(async () => {
    const messages = await readMessages();
    const operationResult = await operation(messages);
    if (operationResult.write) await writeMessages(messages);
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export async function initializeMessageStore() {
  await withMessages(async () => {
    try {
      await readFile(dataFile);
      return { value: undefined, write: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { value: undefined, write: true };
    }
  });
}

export function listConversation(firstUserId, secondUserId) {
  return withMessages((messages) => ({
    value: messages
      .filter(
        (message) =>
          (message.senderId === firstUserId && message.recipientId === secondUserId) ||
          (message.senderId === secondUserId && message.recipientId === firstUserId),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-200),
    write: false,
  }));
}

export function createMessage({ senderId, recipientId, content }) {
  return withMessages((messages) => {
    const message = {
      id: randomUUID(),
      senderId,
      recipientId,
      content,
      createdAt: new Date().toISOString(),
    };
    messages.push(message);
    return { value: message, write: true };
  });
}
