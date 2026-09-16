# Product direction backlog

Status: discovery notes, not an implementation authorization.

## Product problem

The current product demonstrates forecast accountability well, but a new user must wait for
their own forecast/observation pairs before seeing meaningful accuracy. That creates a weak first
session and a risk that the user leaves before the product proves its value.

## Strongest future direction

Offer an immediate shared benchmark for a fixed set of Ukrainian cities, then let users add their
own locations for personal tracking. The shared archive must be clearly labelled as a
precollected model/provider benchmark and must not be mixed with a user's personal collection.

Open-Meteo documents a Historical Forecast API that archives past forecast runs and a Previous Runs
API that exposes values at fixed lead times such as one to seven days. The latter is a promising
source for an initial benchmark because it preserves a controlled forecast horizon and avoids
waiting for a new user to accumulate a week of data. The exact source, license, retention, and
reference-observation policy still require a bounded implementation review.

## Provider comparison concept

There is an established market for this: ForecastWatch operates a commercial verification
platform, and ForecastAdvisor presents consumer-facing provider comparisons for a location.
This validates the user need, but our differentiation should be local transparency, Ukrainian
cities, open methodology, and personal history rather than a generic global ranking.

Providers should not be treated as independent weather worlds. They may share numerical models,
observations, satellite/radar inputs, or upstream model centres, while differing in location
mapping, downscaling, post-processing, update time, ensemble use, and presentation. A fair
comparison must fix:

1. exact coordinates and timezone;
2. forecast issue time and lead horizon;
3. target variable and unit;
4. reference observation source and matching window;
5. missing-data and revision rules;
6. metric, sample size, and confidence/status label.

The first benchmark should compare one or two clearly identified forecast products, not merely
brand names. It should retain provider/model, run time, raw forecast, observation source, and
calculation version so results are reproducible.

## User value hypotheses

- Personal trust: learn which source is most reliable for a user's city and horizon.
- Decision support: choose a source before travel, outdoor work, sport, or an event.
- Local leaderboard: see which provider performs best in a Ukrainian city.
- Forecast disagreement: show when providers disagree materially, signalling uncertainty.
- Educational feedback: explain why a forecast can be wrong without presenting a false winner.
- Public accountability: publish an auditable methodology instead of marketing claims.

## Retention and activation options

Prioritise options that create value in the first session:

- shared precollected benchmark for regional capitals;
- a provisional “best source for my city” card with sample size and uncertainty;
- weekly personal accuracy digest and meaningful change alerts;
- city/provider comparison cards that are easy to share;
- a forecast diary or lightweight prediction challenge with streaks and badges;
- a “what changed?” view showing forecast revisions before an important day;
- personal recommendations after enough data: “for rain use A; for temperature at 1 day use B.”

Gamification should support understanding, not reward meaningless daily visits. Any ranking must show
sample size, horizon, period, location, and metric; otherwise it will encourage overconfident
conclusions from a tiny sample.

## Proposed sequence

1. Finish and merge the current UI wording/state fix in PR #65.
2. Monitor production collection and validate the first real 1-day pairs.
3. Run a small archive proof of concept for five Ukrainian cities and one provider/model, with a
   separate shared-benchmark data boundary.
4. Add a first-session benchmark card and a clear “personal data” path.
5. Add a second provider only after the comparison contract, licensing, and observation baseline
   are reviewed.
6. Add charts, shareable summaries, and weekly return loops after the benchmark is trustworthy.

## Success signals to measure

- percentage of new users who reach a meaningful benchmark in their first session;
- location added and first return after seven days;
- views of provider comparison and forecast-revision explanations;
- number of users with at least one personal paired result;
- retention after a weekly accuracy digest;
- percentage of comparison rows with sufficient sample size and complete provenance.

