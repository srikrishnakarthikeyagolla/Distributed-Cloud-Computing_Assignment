import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/connections.json", import.meta.url));
let operationQueue = Promise.resolve();

async function readConnections() {
  try {
    const contents = await readFile(dataFile, "utf8");
    const connections = JSON.parse(contents);
    if (!Array.isArray(connections)) {
      throw new Error("The connections data file must contain a JSON array.");
    }
    return connections;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeConnections(connections) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `connections.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(connections, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write connections.");
    }
    throw error;
  }
}

function withConnections(operation) {
  const result = operationQueue.then(async () => {
    const connections = await readConnections();
    const operationResult = await operation(connections);
    if (operationResult.write) await writeConnections(connections);
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export function initializeConnectionStore() {
  return withConnections(async () => {
    try {
      await readFile(dataFile);
      return { value: undefined, write: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { value: undefined, write: true };
    }
  });
}

export function findConnection(firstUserId, secondUserId) {
  return withConnections((connections) => ({
    value: connections.find(
      (connection) =>
        (connection.requesterId === firstUserId && connection.recipientId === secondUserId) ||
        (connection.requesterId === secondUserId && connection.recipientId === firstUserId),
    ) ?? null,
    write: false,
  }));
}

export function listConnectionsForUser(userId) {
  return withConnections((connections) => ({
    value: connections.filter(
      (connection) => connection.requesterId === userId || connection.recipientId === userId,
    ),
    write: false,
  }));
}

export function createConnectionRequest(requesterId, recipientId) {
  return withConnections((connections) => {
    const existingIndex = connections.findIndex(
      (connection) =>
        (connection.requesterId === requesterId && connection.recipientId === recipientId) ||
        (connection.requesterId === recipientId && connection.recipientId === requesterId),
    );
    if (existingIndex >= 0) return { value: connections[existingIndex], write: false };
    const connection = {
      id: randomUUID(),
      requesterId,
      recipientId,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    connections.push(connection);
    return { value: connection, write: true };
  });
}

export function acceptConnection(requesterId, recipientId) {
  return withConnections((connections) => {
    const connection = connections.find(
      (item) => item.requesterId === requesterId && item.recipientId === recipientId,
    );
    if (!connection) return { value: null, write: false };
    connection.status = "accepted";
    connection.updatedAt = new Date().toISOString();
    return { value: connection, write: true };
  });
}
