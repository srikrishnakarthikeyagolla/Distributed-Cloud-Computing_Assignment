import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/business-deals.json", import.meta.url));
let operationQueue = Promise.resolve();

async function readDeals() {
  try {
    const deals = JSON.parse(await readFile(dataFile, "utf8"));
    if (!Array.isArray(deals)) throw new Error("The business deals file must contain a JSON array.");
    return deals;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeDeals(deals) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `business-deals.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(deals, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write business deals.");
    }
    throw error;
  }
}

function withDeals(operation) {
  const result = operationQueue.then(async () => {
    const deals = await readDeals();
    const operationResult = await operation(deals);
    if (operationResult.write) await writeDeals(deals);
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export async function initializeBusinessDealStore() {
  return withDeals(async () => {
    try {
      await readFile(dataFile);
      return { value: undefined, write: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { value: undefined, write: true };
    }
  });
}

export function listBusinessDeals(userId, businessId) {
  return withDeals((deals) => ({
    value: deals
      .filter((deal) => deal.userId === userId && deal.businessId === businessId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    write: false,
  }));
}

export function listBusinessDealsForUser(userId) {
  return withDeals((deals) => ({
    value: deals.filter((deal) => deal.userId === userId),
    write: false,
  }));
}

export function listBusinessDealsForBusiness(businessId) {
  return withDeals((deals) => ({
    value: deals.filter((deal) => deal.businessId === businessId),
    write: false,
  }));
}

export function findBusinessDealById(dealId) {
  return withDeals((deals) => ({
    value: deals.find((deal) => deal.id === dealId) ?? null,
    write: false,
  }));
}

export function createBusinessDeal({ userId, businessId, creatorType, proposal }) {
  return withDeals((deals) => {
    const now = new Date().toISOString();
    const deal = {
      id: randomUUID(),
      userId,
      businessId,
      creatorType,
      proposal,
      status: "pending",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    deals.push(deal);
    return { value: deal, write: true };
  });
}

export function updateBusinessDealStatus(dealId, action, actorType) {
  return withDeals((deals) => {
    const deal = deals.find((item) => item.id === dealId);
    if (!deal) return { value: null, write: false };
    if (action === "accept" || action === "pass") {
      if (deal.status !== "pending" || deal.creatorType === actorType) {
        return { value: null, write: false };
      }
      deal.status = action === "accept" ? "accepted" : "declined";
    } else if (action === "fulfill") {
      if (deal.status !== "accepted") return { value: null, write: false };
      deal.status = "fulfilled";
    } else {
      return { value: null, write: false };
    }
    deal.updatedAt = new Date().toISOString();
    if (action === "fulfill") {
      deal.fulfilledBy = actorType;
      deal.fulfilledAt = deal.updatedAt;
    }
    return { value: deal, write: true };
  });
}

export function addBusinessDealMessage(dealId, senderType, content) {
  return withDeals((deals) => {
    const deal = deals.find((item) => item.id === dealId);
    if (!deal || deal.status !== "accepted") return { value: null, write: false };
    const message = {
      id: randomUUID(),
      senderType,
      content,
      createdAt: new Date().toISOString(),
    };
    deal.messages.push(message);
    deal.updatedAt = message.createdAt;
    return { value: { deal, message }, write: true };
  });
}
