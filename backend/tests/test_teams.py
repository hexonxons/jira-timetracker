import pytest

from jtt.teams import TeamsConfigError, parse_teams_config


def errors_of(raw):
    with pytest.raises(TeamsConfigError) as exc:
        parse_teams_config(raw)
    return exc.value.errors


def test_valid_config_keeps_order():
    teams = parse_teams_config({"teams": [{"name": "B", "users": ["u1"]}, {"name": "A", "users": []}]})
    assert [t.name for t in teams] == ["B", "A"]
    assert teams[0].users == ("u1",)


@pytest.mark.parametrize("raw", [None, [], {"teams": {}}, {"team": []}])
def test_wrong_shape(raw):
    assert errors_of(raw)


def test_empty_teams():
    assert errors_of({"teams": []}) == ['"teams" array is empty.']


def test_user_in_two_teams_is_reported_case_insensitively():
    errors = errors_of({"teams": [{"name": "A", "users": ["Alice"]}, {"name": "B", "users": ["alice"]}]})
    assert len(errors) == 1 and '"A" and "B"' in errors[0]


def test_collects_all_errors():
    errors = errors_of(
        {
            "teams": [
                {"name": "A", "users": ["x", "x", 5]},
                {"name": "A", "users": "y"},
                {"users": []},
            ]
        }
    )
    assert len(errors) == 5
