import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import AccessControl "mo:caffeineai-authorization/access-control";
import Types "../types/matches";
import MatchesLib "../lib/matches";

mixin (
  accessControlState : AccessControl.AccessControlState,
  matches : Map.Map<Principal, [Types.MatchRecord]>,
  nextMatchId : { var value : Nat },
  settings : Map.Map<Principal, Types.PlayerSettings>,
) {
  /// The anonymous principal is a single shared identity: every unauthenticated
  /// visitor presents it, so keying caller-scoped data on it would let one
  /// anonymous visitor read another's rows. Caller-scoped endpoints therefore
  /// require a stable (non-anonymous) identity.
  func requireStableIdentity(caller : Principal) : () {
    if (caller.isAnonymous()) {
      Runtime.trap("Unauthorized: sign in to access your match data");
    };
  };

  /// Records a completed skirmish for the signed-in caller.
  public shared ({ caller }) func recordMatch(
    faction : Types.Faction,
    mapSize : Types.MapSize,
    difficulty : Types.AiDifficulty,
    result : Types.MatchResult,
    durationSeconds : Nat,
  ) : async Types.MatchId {
    ignore accessControlState;
    requireStableIdentity(caller);
    MatchesLib.recordMatch(matches, nextMatchId, caller, faction, mapSize, difficulty, result, durationSeconds);
  };

  /// Lists the caller's most recent matches, newest first.
  public query ({ caller }) func listRecentMatches(limit : Nat) : async [Types.MatchRecord] {
    ignore accessControlState;
    if (caller.isAnonymous()) {
      return [];
    };
    MatchesLib.listRecentMatches(matches, caller, limit);
  };

  /// Returns aggregate win/loss and per-faction statistics for the caller.
  public query ({ caller }) func getMatchStats() : async Types.MatchStats {
    ignore accessControlState;
    if (caller.isAnonymous()) {
      return MatchesLib.emptyStats();
    };
    MatchesLib.getStats(matches, caller);
  };

  /// Reads the caller's saved settings.
  public query ({ caller }) func getSettings() : async ?Types.PlayerSettings {
    ignore accessControlState;
    if (caller.isAnonymous()) {
      return null;
    };
    MatchesLib.getSettings(settings, caller);
  };

  /// Saves the caller's settings and returns the stored value.
  public shared ({ caller }) func saveSettings(value : Types.PlayerSettings) : async Types.PlayerSettings {
    ignore accessControlState;
    requireStableIdentity(caller);
    MatchesLib.saveSettings(settings, caller, value);
  };
};
