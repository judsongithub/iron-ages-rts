import Common "common";

module {
  public type Timestamp = Common.Timestamp;
  public type MatchId = Common.MatchId;

  /// The three playable factions spanning the historical era.
  public type Faction = {
    #romans;
    #mongols;
    #vikings;
  };

  /// Procedurally generated map size chosen at match setup.
  public type MapSize = {
    #small;
    #medium;
    #large;
  };

  /// AI opponent difficulty chosen at match setup.
  public type AiDifficulty = {
    #easy;
    #normal;
    #hard;
  };

  /// Outcome of a completed skirmish.
  public type MatchResult = {
    #victory;
    #defeat;
  };

  /// A durable record of one completed single-player skirmish.
  public type MatchRecord = {
    id : MatchId;
    faction : Faction;
    mapSize : MapSize;
    difficulty : AiDifficulty;
    result : MatchResult;
    /// Match length in seconds.
    durationSeconds : Nat;
    /// When the match was recorded.
    recordedAt : Timestamp;
  };

  /// Per-faction aggregate of the caller's completed matches.
  public type FactionStats = {
    faction : Faction;
    wins : Nat;
    losses : Nat;
    totalMatches : Nat;
  };

  /// Aggregate statistics across all of the caller's completed matches.
  public type MatchStats = {
    totalMatches : Nat;
    wins : Nat;
    losses : Nat;
    /// Total play time across all matches, in seconds.
    totalDurationSeconds : Nat;
    byFaction : [FactionStats];
  };

  /// Caller-scoped preferences carried between matches.
  public type PlayerSettings = {
    preferredFaction : Faction;
    preferredDifficulty : AiDifficulty;
    lastMapSize : MapSize;
  };
};
