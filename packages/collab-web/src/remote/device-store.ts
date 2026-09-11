export const REMOTE_DEVICE_TOKEN_KEY = "omp.remote.device-token";

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function usableToken(value: string | null): string | undefined {
	if (!value || value.length > 512 || /[\u0000-\u0020\u007f]/u.test(value)) return undefined;
	return value;
}

/** Stores only the paired device token; connection state and logs stay in memory. */
export class DeviceStore {
	readonly #storage: StorageLike | undefined;

	constructor(storage?: StorageLike) {
		this.#storage = storage;
	}

	read(): string | undefined {
		if (!this.#storage) return undefined;
		try {
			return usableToken(this.#storage.getItem(REMOTE_DEVICE_TOKEN_KEY));
		} catch {
			return undefined;
		}
	}

	write(token: string): void {
		const valid = usableToken(token);
		if (!valid) throw new Error("Device token is invalid");
		if (!this.#storage) throw new Error("Browser storage is unavailable");
		try {
			this.#storage.setItem(REMOTE_DEVICE_TOKEN_KEY, valid);
		} catch {
			throw new Error("Browser storage is unavailable");
		}
	}

	clear(): void {
		try {
			this.#storage?.removeItem(REMOTE_DEVICE_TOKEN_KEY);
		} catch {
			// Private browsing and quota errors should not leave the live socket open.
		}
	}
}

/** Build a device store without touching localStorage during server-side rendering. */
export function createDeviceStore(storage?: StorageLike): DeviceStore {
	if (storage) return new DeviceStore(storage);
	try {
		return new DeviceStore(globalThis.localStorage);
	} catch {
		return new DeviceStore();
	}
}
