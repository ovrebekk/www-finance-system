import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Used when the email is unknown, so a failed login takes as long as a wrong
 * password and response time does not reveal which emails exist.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hash('not-a-real-password-just-for-timing');
  await verifyPassword(await dummyHash, password);
}
