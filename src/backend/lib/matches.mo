import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Types "../types/matches";

module {
  /// Appends a completed match for `caller` and returns its assigned id.
  public func recordMatch(
    matches : Map.Map<Principal, [Types.MatchRecord]>,
    nextMatchId : { var value : Nat },
    caller : Principal,
    faction : Types.Faction,
    mapSize : Types.MapSize,
    difficulty : Types.AiDifficulty,
    result : Types.MatchResult,
    durationSeconds : Nat,
  ) : Types.MatchId {
    let id = nextMatchId.value;
    nextMatchId.value := id + 1;
    let record : Types.MatchRecord = {
      id;
      faction;
      mapSize;
      difficulty;
      result;
      durationSeconds;
      recordedAt = Time.now().toNat();
    };
    let existing = matches.get(caller) ?? [];
    matches.add(caller, existing.concat([record]));
    id;
  };

  /// Returns the caller's most recent matches, newest first, capped at `limit`.
  public func listRecentMatches(
    matches : Map.Map<Principal, [Types.MatchRecord]>,
    caller : Principal,
    limit : Nat,
  ) : [Types.MatchRecord] {
    let all = matches.get(caller) ?? [];
    let newestFirst = all.reverse();
    if (newestFirst.size() <= limit) {
      newestFirst;
    } else {
      newestFirst.sliceToArray(0, limit);
    };
  };

  /// The zero-valued statistics returned for a caller with no matches.
  public func emptyStats() : Types.MatchStats {
    {
      totalMatches = 0;
      wins = 0;
      losses = 0;
      totalDurationSeconds = 0;
      byFaction = [
        (#romans, { var wins = 0; var losses = 0 }),
        (#mongols, { var wins = 0; var losses = 0 }),
        (#vikings, { var wins = 0; var losses = 0 }),
      ].map(
        func ((faction, tally)) = {
          faction;
          wins = tally.wins;
          losses = tally.losses;
          totalMatches = tally.wins + tally.losses;
        }
      );
    };
  };

  /// Computes aggregate win/loss and per-faction statistics for the caller.
  public func getStats(
    matches : Map.Map<Principal, [Types.MatchRecord]>,
    caller : Principal,
  ) : Types.MatchStats {
    let all = matches.get(caller) ?? [];
    var wins = 0;
    var losses = 0;
    var totalDurationSeconds = 0;
    let byFaction = [
      (#romans, { var wins = 0; var losses = 0 }),
      (#mongols, { var wins = 0; var losses = 0 }),
      (#vikings, { var wins = 0; var losses = 0 }),
    ];
    for (record in all.values()) {
      totalDurationSeconds += record.durationSeconds;
      switch (record.result) {
        case (#victory) { wins += 1 };
        case (#defeat) { losses += 1 };
      };
      for ((faction, tally) in byFaction.values()) {
        if (faction == record.faction) {
          switch (record.result) {
            case (#victory) { tally.wins += 1 };
            case (#defeat) { tally.losses += 1 };
          };
        };
      };
    };
    {
      totalMatches = all.size();
      wins;
      losses;
      totalDurationSeconds;
      byFaction = byFaction.map(
        func ((faction, tally)) = {
          faction;
          wins = tally.wins;
          losses = tally.losses;
          totalMatches = tally.wins + tally.losses;
        }
      );
    };
  };

  /// Reads the caller's saved settings, if any.
  public func getSettings(
    settings : Map.Map<Principal, Types.PlayerSettings>,
    caller : Principal,
  ) : ?Types.PlayerSettings {
    settings.get(caller);
  };

  /// Persists the caller's settings and returns the stored value.
  public func saveSettings(
    settings : Map.Map<Principal, Types.PlayerSettings>,
    caller : Principal,
    value : Types.PlayerSettings,
  ) : Types.PlayerSettings {
    settings.add(caller, value);
    value;
  };
};
