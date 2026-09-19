import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";

module {
  type Faction = { #romans; #mongols; #vikings };
  type MapSize = { #small; #medium; #large };
  type AiDifficulty = { #easy; #normal; #hard };
  type MatchResult = { #victory; #defeat };

  type MatchRecord = {
    id : Nat;
    faction : Faction;
    mapSize : MapSize;
    difficulty : AiDifficulty;
    result : MatchResult;
    durationSeconds : Nat;
    recordedAt : Nat;
  };

  type PlayerSettings = {
    preferredFaction : Faction;
    preferredDifficulty : AiDifficulty;
    lastMapSize : MapSize;
  };

  type NewActor = {
    accessControlState : AccessControl.AccessControlState;
    matches : Map.Map<Principal, [MatchRecord]>;
    nextMatchId : { var value : Nat };
    settings : Map.Map<Principal, PlayerSettings>;
  };

  public func migration(_old : {}) : NewActor {
    {
      accessControlState = AccessControl.initState();
      matches = Map.empty();
      nextMatchId = { var value = 0 };
      settings = Map.empty();
    };
  };
};
