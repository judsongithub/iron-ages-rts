import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface Cell {
    value: Value;
    name: string;
}
export type Error_ = {
    __kind__: "FrontendOriginsNotConfigured";
    FrontendOriginsNotConfigured: null;
} | {
    __kind__: "MixedSsoSources";
    MixedSsoSources: {
        otherKeys: Array<string>;
        ssoKeys: Array<string>;
    };
} | {
    __kind__: "Stale";
    Stale: {
        ageNs: bigint;
    };
} | {
    __kind__: "MalformedCandid";
    MalformedCandid: null;
} | {
    __kind__: "AmbiguousAttribute";
    AmbiguousAttribute: {
        field: string;
        sources: Array<string>;
    };
} | {
    __kind__: "NoAttributes";
    NoAttributes: null;
} | {
    __kind__: "UnknownNonce";
    UnknownNonce: null;
} | {
    __kind__: "UntrustedSsoSource";
    UntrustedSsoSource: {
        domain: string;
    };
} | {
    __kind__: "MissingField";
    MissingField: string;
} | {
    __kind__: "FrontendOriginMismatch";
    FrontendOriginMismatch: {
        got: string;
        expected: Array<string>;
    };
};
export interface FactionStats {
    totalMatches: bigint;
    wins: bigint;
    losses: bigint;
    faction: Faction;
}
export type MatchId = bigint;
export interface MatchRecord {
    id: MatchId;
    result: MatchResult;
    mapSize: MapSize;
    difficulty: AiDifficulty;
    recordedAt: Timestamp;
    durationSeconds: bigint;
    faction: Faction;
}
export interface MatchStats {
    totalMatches: bigint;
    byFaction: Array<FactionStats>;
    wins: bigint;
    losses: bigint;
    totalDurationSeconds: bigint;
}
export interface PlayerSettings {
    preferredFaction: Faction;
    preferredDifficulty: AiDifficulty;
    lastMapSize: MapSize;
}
export interface Result {
    hasMore: boolean;
    rows: Array<Array<Cell>>;
}
export type Result__1 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: Error_;
};
export type Timestamp = bigint;
export type Value = {
    __kind__: "int";
    int: bigint;
} | {
    __kind__: "nat";
    nat: bigint;
} | {
    __kind__: "float";
    float: number;
} | {
    __kind__: "bool";
    bool: boolean;
} | {
    __kind__: "null";
    null: null;
} | {
    __kind__: "text";
    text: string;
};
export enum AiDifficulty {
    normal = "normal",
    easy = "easy",
    hard = "hard"
}
export enum Faction {
    vikings = "vikings",
    mongols = "mongols",
    romans = "romans"
}
export enum MapSize {
    large = "large",
    small = "small",
    medium = "medium"
}
export enum MatchResult {
    defeat = "defeat",
    victory = "victory"
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    execute(qJson: string): Promise<Result>;
    /**
     * / Returns the public API documentation as static Markdown.
     */
    getApiDoc(): Promise<string>;
    getCallerUserRole(): Promise<UserRole>;
    /**
     * / Returns aggregate win/loss and per-faction statistics for the caller.
     */
    getMatchStats(): Promise<MatchStats>;
    /**
     * / Reads the caller's saved settings.
     */
    getSettings(): Promise<PlayerSettings | null>;
    isCallerAdmin(): Promise<boolean>;
    /**
     * / Lists the caller's most recent matches, newest first.
     */
    listRecentMatches(limit: bigint): Promise<Array<MatchRecord>>;
    /**
     * / Records a completed skirmish for the signed-in caller.
     */
    recordMatch(faction: Faction, mapSize: MapSize, difficulty: AiDifficulty, result: MatchResult, durationSeconds: bigint): Promise<MatchId>;
    /**
     * / Saves the caller's settings and returns the stored value.
     */
    saveSettings(value: PlayerSettings): Promise<PlayerSettings>;
    schema(): Promise<string>;
}
