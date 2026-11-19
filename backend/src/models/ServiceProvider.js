import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/service-providers.json", import.meta.url));
let operationQueue = Promise.resolve();

async function readProviders() {
  try {
    const providers = JSON.parse(await readFile(dataFile, "utf8"));
    if (!Array.isArray(providers)) throw new Error("The service providers file must contain a JSON array.");
    return providers;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeProviders(providers) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `service-providers.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(providers, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write service providers.");
    }
    throw error;
  }
}

function withProviders(operation) {
  const result = operationQueue.then(async () => {
    const providers = await readProviders();
    const operationResult = await operation(providers);
    if (operationResult.write) await writeProviders(providers);
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export async function initializeServiceProviderStore() {
  return withProviders(async () => {
    try {
      await readFile(dataFile);
      return { value: undefined, write: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { value: undefined, write: true };
    }
  });
}

export function createServiceProvider(details) {
  return withProviders((providers) => {
    if (providers.some((provider) => provider.email === details.email)) {
      const error = new Error("An account with this email already exists.");
      error.name = "DuplicateServiceProviderEmailError";
      throw error;
    }
    const provider = {
      id: randomUUID(),
      isVisible: true,
      ...details,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    providers.push(provider);
    return { value: provider, write: true };
  });
}

export function findServiceProviderByEmail(email) {
  return withProviders((providers) => ({
    value: providers.find((provider) => provider.email === email) ?? null,
    write: false,
  }));
}

export function findServiceProviderById(id) {
  return withProviders((providers) => ({
    value: providers.find((provider) => provider.id === id) ?? null,
    write: false,
  }));
}

export function findServiceProvidersByPincode(pincode) {
  const normalizedPincode = pincode.trim().toUpperCase();
  return withProviders((providers) => ({
    value: providers.filter((provider) =>
      provider.isVisible !== false &&
      provider.pincode.trim().toUpperCase() === normalizedPincode
    ),
    write: false,
  }));
}

export function updateServiceProvider(id, changes) {
  return withProviders((providers) => {
    const provider = providers.find((item) => item.id === id);
    if (!provider) return { value: null, write: false };
    Object.assign(provider, changes, { updatedAt: new Date().toISOString() });
    return { value: provider, write: true };
  });
}
