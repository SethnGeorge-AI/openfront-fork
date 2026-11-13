// @vitest-environment jsdom
import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { Crown } from "@openfront/shared/CosmeticSchemas";
import {
  cosmeticRelationship,
  crownRelationship,
} from "../src/client/Cosmetics";

function makeUserMe(flares: string[]): UserMeResponse {
  return {
    player: { flares },
  } as unknown as UserMeResponse;
}

describe("cosmeticRelationship", () => {
  it("returns owned when user has wildcard flare", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["flag:*"]),
      ),
    ).toBe("owned");
  });

  it("returns owned when user has the specific flare", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "flag:*",
          requiredFlare: "flag:cool",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["flag:cool"]),
      ),
    ).toBe("owned");
  });

  it("returns owned when user has wildcard flare for patterns", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "pattern:*",
          requiredFlare: "pattern:stripes:red",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["pattern:*"]),
      ),
    ).toBe("owned");
  });

  it("returns owned when user has wildcard flare for crowns", () => {
    expect(
      cosmeticRelationship(
        {
          wildcardFlare: "crown:*",
          requiredFlare: "crown:gold",
          priceSoft: undefined,
          priceHard: undefined,
          affiliateCode: null,
          itemAffiliateCode: null,
        },
        makeUserMe(["crown:*"]),
      ),
    ).toBe("owned");
  });
});

describe("crownRelationship", () => {
  const crown = { name: "gold", url: "/crowns/gold.png" } as Crown;

  it("returns owned when user has the crown:* wildcard flare", () => {
    expect(crownRelationship(crown, makeUserMe(["crown:*"]), null)).toBe(
      "owned",
    );
  });

  it("returns owned when user has the specific crown flare", () => {
    expect(crownRelationship(crown, makeUserMe(["crown:gold"]), null)).toBe(
      "owned",
    );
  });
});
