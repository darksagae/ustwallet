import { Connection } from "@solana/web3.js";
import { RPC_URL } from "./constants";

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(RPC_URL, "confirmed");
  }
  return connection;
}
