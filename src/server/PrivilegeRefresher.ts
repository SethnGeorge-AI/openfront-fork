import { ReservedClanTagsResponseSchema } from "@openfront/shared/ClanApiSchemas";
import { CosmeticsSchema } from "@openfront/shared/CosmeticSchemas";
import fs from "fs/promises";
import { base64url } from "jose";
import { Logger } from "winston";
import { startPolling } from "./PollingLoop";
import {
  FailOpenPrivilegeChecker,
  PrivilegeChecker,
  PrivilegeCheckerImpl,
} from "./Privilege";

// Refreshes the privilege checker every 3 minutes.
// WARNING: This fails open if cosmetics.json is not available.
export class PrivilegeRefresher {
  private privilegeChecker: PrivilegeChecker | null = null;
  private failOpenPrivilegeChecker: PrivilegeChecker =
    new FailOpenPrivilegeChecker();

  private log: Logger;

  constructor(
    // This fork's catalog is a local file (resources/cosmetics/catalog.json).
    private cosmeticsPath: string,
    private apiKey: string,
    private reservedClanTagsEndpoint: string,
    parentLog: Logger,
    private refreshInterval: number = 1000 * 60 * 3,
  ) {
    this.log = parentLog.child({ comp: "privilege-refresher" });
  }

  public async start() {
    this.log.info(
      `Starting privilege refresher with interval ${this.refreshInterval}`,
    );
    startPolling(() => this.loadPrivilegeChecker(), this.refreshInterval);
  }

  public get(): PrivilegeChecker {
    return this.privilegeChecker ?? this.failOpenPrivilegeChecker;
  }

  private async loadPrivilegeChecker(): Promise<void> {
    this.log.info(`Loading privilege checker`);
    try {
      const fetchWithTimeout = async (url: string) => {
        try {
          return await fetch(url, {
            signal: AbortSignal.timeout(5000),
            headers: { "x-api-key": this.apiKey },
          });
        } catch (error) {
          this.log.warn(`Failed to fetch ${url}: ${error}`);
          return null;
        }
      };

      const [cosmeticsData, reservedClanTagsResponse] = await Promise.all([
        fs.readFile(this.cosmeticsPath, "utf8").then(JSON.parse),
        fetchWithTimeout(this.reservedClanTagsEndpoint),
      ]);
      const result = CosmeticsSchema.safeParse(cosmeticsData);

      if (!result.success) {
        throw new Error(`Invalid cosmetics data: ${result.error.message}`);
      }

      // This fork has no clans service: without the list every tag is
      // fictional and kept, as the fail-open checker did. A list that does
      // arrive but is malformed still throws, keeping the previous checker.
      if (!reservedClanTagsResponse || !reservedClanTagsResponse.ok) {
        this.privilegeChecker = new PrivilegeCheckerImpl(
          result.data,
          base64url.decode,
          new Set(),
        );
        this.log.info("Privilege checker loaded (no reserved clan tags)");
        return;
      }
      const reservedClanTagsData = await reservedClanTagsResponse.json();
      const reservedClanTagsResult =
        ReservedClanTagsResponseSchema.safeParse(reservedClanTagsData);
      if (!reservedClanTagsResult.success) {
        throw new Error(
          `Invalid reserved clan tags data: ${reservedClanTagsResult.error.message}`,
        );
      }
      const reservedClanTags = new Set(
        reservedClanTagsResult.data.map((tag) => tag.toUpperCase()),
      );

      this.privilegeChecker = new PrivilegeCheckerImpl(
        result.data,
        base64url.decode,
        reservedClanTags,
      );
      this.log.info(
        `Privilege checker loaded successfully (${reservedClanTags.size} reserved clan tags)`,
      );
    } catch (error) {
      this.log.error(`Failed to load privilege checker:`, error);
      throw error;
    }
  }
}
