"""Validation of the team configuration (the only source of Jira user -> team mapping)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Team:
    name: str
    users: tuple[str, ...]


class TeamsConfigError(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def parse_teams_config(raw: Any) -> list[Team]:
    """Validate a raw teams config and return teams in config order.

    Collects every problem instead of stopping at the first one, so the user
    can fix the whole file in one pass. Usernames are compared
    case-insensitively, as Jira does.
    """
    errors: list[str] = []
    if not isinstance(raw, dict) or not isinstance(raw.get("teams"), list):
        raise TeamsConfigError(['Config must be a JSON object with a "teams" array.'])
    if not raw["teams"]:
        raise TeamsConfigError(['"teams" array is empty.'])

    teams: list[Team] = []
    team_names: set[str] = set()
    owner: dict[str, str] = {}  # lower-cased username -> team name
    for i, item in enumerate(raw["teams"]):
        where = f"teams[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{where}: must be an object with \"name\" and \"users\".")
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            errors.append(f"{where}: \"name\" must be a non-empty string.")
            continue
        name = name.strip()
        where = f'Team "{name}"'
        if name in team_names:
            errors.append(f"{where}: team name is used more than once.")
        team_names.add(name)

        users = item.get("users")
        if not isinstance(users, list):
            errors.append(f'{where}: "users" must be an array of Jira usernames.')
            continue
        clean: list[str] = []
        for j, user in enumerate(users):
            if not isinstance(user, str) or not user.strip():
                errors.append(f"{where}: users[{j}] must be a non-empty string.")
                continue
            user = user.strip()
            key = user.lower()
            if key in owner:
                if owner[key] == name:
                    errors.append(f'{where}: user "{user}" is listed more than once.')
                else:
                    errors.append(
                        f'User "{user}" is listed in several teams: "{owner[key]}" and "{name}". '
                        "A user must belong to exactly one team."
                    )
                continue
            owner[key] = name
            clean.append(user)
        teams.append(Team(name=name, users=tuple(clean)))

    if errors:
        raise TeamsConfigError(errors)
    return teams
