import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataFile = fileURLToPath(new URL("../../data/users.json", import.meta.url));
let operationQueue = Promise.resolve();

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "DuplicateEmailError";
  }
}

async function readUsers() {
  try {
    const contents = await readFile(dataFile, "utf8");
    const users = JSON.parse(contents);
    if (!Array.isArray(users)) {
      throw new Error("The users data file must contain a JSON array.");
    }
    return users;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeUsers(users) {
  await mkdir(dirname(dataFile), { recursive: true });
  const temporaryFile = join(dirname(dataFile), `users.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryFile, `${JSON.stringify(users, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryFile, dataFile);
  } catch (error) {
    try {
      await rm(temporaryFile, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Failed to write the local users file and clean up its temporary file.");
    }
    throw error;
  }
}

function withUsers(operation) {
  const result = operationQueue.then(async () => {
    const users = await readUsers();
    const operationResult = await operation(users);
    if (operationResult.write) {
      await writeUsers(users);
    }
    return operationResult.value;
  });
  operationQueue = result.catch(() => {});
  return result;
}

export async function initializeUserStore() {
  await withUsers(async () => {
    if (!(await fileExists())) {
      return { value: undefined, write: true };
    }
    return { value: undefined, write: false };
  });
}

async function fileExists() {
  try {
    await readFile(dataFile);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function createUser(userDetails) {
  return withUsers((users) => {
    if (users.some((user) => user.email === userDetails.email)) {
      throw new DuplicateEmailError();
    }
    const user = {
      id: randomUUID(),
      ...userDetails,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    return { value: user, write: true };
  });
}

export function findUserByEmail(email) {
  return withUsers((users) => ({
    value: users.find((user) => user.email === email) ?? null,
    write: false,
  }));
}

export function findUserById(id) {
  return withUsers((users) => ({
    value: users.find((user) => user.id === id) ?? null,
    write: false,
  }));
}

export function findUsersByPincode(pincode, excludingId) {
  const normalizedPincode = pincode.trim().toUpperCase();
  return withUsers((users) => ({
    value: users.filter(
      (user) =>
        user.id !== excludingId &&
        typeof user.pincode === "string" &&
        user.pincode.trim().toUpperCase() === normalizedPincode,
    ),
    write: false,
  }));
}

export function updateUserVisibility(userId, visibility) {
  return withUsers((users) => {
    const user = users.find((item) => item.id === userId);
    if (!user) return { value: null, write: false };
    user.visibility = visibility;
    return { value: user, write: true };
  });
}

export function updateUserPasswordHash(userId, passwordHash) {
  return withUsers((users) => {
    const user = users.find((item) => item.id === userId);
    if (!user) return { value: null, write: false };
    user.passwordHash = passwordHash;
    return { value: user, write: true };
  });
}

export function updateUserProfilePhoto(userId, profilePhoto) {
  return withUsers((users) => {
    const user = users.find((item) => item.id === userId);
    if (!user) return { value: null, write: false };
    const previousPhoto = user.profilePhoto || null;
    user.profilePhoto = profilePhoto;
    return { value: { user, previousPhoto }, write: true };
  });
}
