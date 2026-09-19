import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";
import MixinAuthorization "mo:caffeineai-authorization/MixinAuthorization";
import Expose "mo:caffeineai-oql/Expose";
import Entity "mo:caffeineai-oql/Entity";
import MapEntity "mo:caffeineai-oql/MapEntity";
import NatValue "mo:caffeineai-oql/NatValue";
import TextValue "mo:caffeineai-oql/TextValue";
import Types "types/matches";
import MatchesApi "mixins/matches-api";
import ApiDocMixin "mixins/api-doc";

actor {
  let accessControlState : AccessControl.AccessControlState;
  include MixinAuthorization(accessControlState, null);

  let matches : Map.Map<Principal, [Types.MatchRecord]>;
  let nextMatchId : { var value : Nat };
  let settings : Map.Map<Principal, Types.PlayerSettings>;

  include MatchesApi(accessControlState, matches, nextMatchId, settings);
  include ApiDocMixin();

  // MatchRecord carries variant fields (Faction, MapSize, AiDifficulty,
  // MatchResult), which have no built-in `_toRow` instance, so the entity is
  // declared in manual mode and each column is rendered explicitly.
  func factionText(f : Types.Faction) : Text = switch f {
    case (#romans) "romans";
    case (#mongols) "mongols";
    case (#vikings) "vikings";
  };

  func mapSizeText(m : Types.MapSize) : Text = switch m {
    case (#small) "small";
    case (#medium) "medium";
    case (#large) "large";
  };

  func difficultyText(d : Types.AiDifficulty) : Text = switch d {
    case (#easy) "easy";
    case (#normal) "normal";
    case (#hard) "hard";
  };

  func resultText(r : Types.MatchResult) : Text = switch r {
    case (#victory) "victory";
    case (#defeat) "defeat";
  };

  // PlayerSettings also carries variant fields, so it is declared in manual
  // mode with the same explicit rendering.
  include Expose({
    entities = [
      matches
        .toEntityManual<Principal, Types.MatchRecord>("match", "MatchRecord", "id")
        .sample({
          id = 0;
          faction = #romans;
          mapSize = #medium;
          difficulty = #normal;
          result = #victory;
          durationSeconds = 0;
          recordedAt = 0;
        })
        .payload("id", func m = m.id)
        .payload("faction", func m = factionText(m.faction))
        .payload("mapSize", func m = mapSizeText(m.mapSize))
        .payload("difficulty", func m = difficultyText(m.difficulty))
        .payload("result", func m = resultText(m.result))
        .payload("durationSeconds", func m = m.durationSeconds)
        .payload("recordedAt", func m = m.recordedAt)
        .controllerOnly()
        .build(),
      settings
        .toEntityManual("playerSettings", "PlayerSettings", "preferredFaction")
        .sample({
          preferredFaction = #romans;
          preferredDifficulty = #normal;
          lastMapSize = #medium;
        })
        .payload("preferredFaction", func s = factionText(s.preferredFaction))
        .payload("preferredDifficulty", func s = difficultyText(s.preferredDifficulty))
        .payload("lastMapSize", func s = mapSizeText(s.lastMapSize))
        .controllerOnly()
        .build(),
    ];
  });
};
