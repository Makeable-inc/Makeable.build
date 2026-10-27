import { createMemoryStore } from "../lib/storage/memory-store.mjs";
import { runStoreContract } from "./helpers/store-contract.mjs";

runStoreContract("memory", () => createMemoryStore());
