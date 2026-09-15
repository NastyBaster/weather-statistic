# Accuracy data contract (Stage 8.0)

Status: **accepted for Stage 8.0 implementation** (2026-09-15).

This contract defines how immutable forecast snapshots are paired with immutable weather
observations and how accuracy is described. It does not add a database object, collect data,
replace the demo UI, or authorize production operations. Stage 8.1 will implement the read model
only after this contract has been reviewed.

## Purpose and boundary

Accuracy is a property of a forecast value at a stated location, target date, and lead horizon.
It is never a property of an unlabelled dashboard number. Every result must expose the provider
data boundary, the forecast lead, the paired sample size, and the sample-size status.

Forecast snapshots remain predictions and observations remain measured actuals. Neither table is
updated or backfilled by the accuracy read model.

## Pairing and eligibility

A paired row is formed only when all of the following match:

1. `forecast_snapshots.location_id = weather_observations.location_id`;
2. `forecast_snapshots.target_date = weather_observations.observation_date`;
3. `forecast_snapshots.lead_days` is one of the supported cohorts: `1`, `3`, `5`, or `7`;
4. the forecast value and corresponding observed value are both non-null.

The accuracy row retains `location_id`, `target_date`, and `lead_days`; aggregation must never
combine different lead cohorts into one score. A missing observation, missing forecast field,
duplicate conflict, or unsupported lead is excluded from that metric and counted in coverage
diagnostics. It must not be converted to zero or treated as a forecast failure.

The first implementation uses the following metric scopes:

| Scope | Meaning |
| --- | --- |
| location + lead | One user's location and one forecast horizon. |
| all-owned-locations + lead | A user's RLS-scoped locations at one horizon, with location count shown. |
| global archive | Not part of this stage; there is no cross-user aggregate. |

The read model must preserve the observation provider and the forecast collection date in its
detail/provenance path. The displayed aggregate must say that it is based on Open-Meteo data and
the actual paired date range.

## Numeric metrics

For each eligible paired value, define the signed error as `forecast - observed` and the absolute
error as `abs(forecast - observed)`.

| Variable | Primary metric | Secondary metric | Unit |
| --- | --- | --- | --- |
| Daily minimum temperature | MAE | Mean signed error (bias) | °C |
| Daily maximum temperature | MAE | Mean signed error (bias) | °C |
| Daily maximum wind speed | MAE | Mean signed error (bias) | km/h |
| Daily precipitation total | MAE | Mean signed error (bias) | mm |

`MAE = sum(abs(error)) / n` and `bias = sum(error) / n`. Values are computed from unrounded
stored numbers; presentation rounding is applied only after aggregation. RMSE is deliberately
not a v1 headline metric because the product needs an interpretable baseline first; it can be
added in a later contract revision without changing the pairing rules.

No numeric metric is emitted when `n = 0`. The result carries `n` and coverage counts for every
metric, including when another variable in the same paired day is available.

## Precipitation event metrics

The v1 event definition is fixed and must not be silently changed by the UI:

- actual rain event: `observed precipitation_sum >= 1.0 mm`;
- predicted rain event: `precipitation_probability >= 50%`;
- event evaluation uses the same `location`, `target_date`, and `lead_days` pairing as numeric
  metrics;
- a missing probability or missing observed precipitation is excluded from the confusion matrix,
  not counted as a negative.

For each eligible paired event row, count:

| Count | Definition |
| --- | --- |
| TP | predicted event and actual event |
| FP | predicted event and no actual event |
| FN | no predicted event and actual event |
| TN | no predicted event and no actual event |

Report all four counts plus:

- `precision = TP / (TP + FP)`;
- `recall = TP / (TP + FN)`;
- `false_alarm_rate = FP / (FP + TN)`.

If a denominator is zero, that metric is `null` with a reason code; it is never displayed as 0%.
The continuous precipitation MAE remains separate from the event metrics. A single “rain
accuracy” percentage is not a valid result.

## Sample-size and reliability policy

Every aggregate includes `sample_size` and `sample_size_status`:

| Paired rows (`n`) | Status | Product wording |
| ---: | --- | --- |
| 0–9 | `insufficient` | “Not enough paired observations yet.” |
| 10–29 | `provisional` | “Early estimate; sample is small.” |
| 30+ | `reliable` | “Based on at least 30 paired observations.” |

For precipitation event metrics, `reliable` additionally requires at least 5 actual rain events
and 5 actual non-events. Otherwise the status is `insufficient` for event conclusions, even when
the total paired `n` is 30 or more. `provisional` may be shown only with both event counts
visible; it must not be phrased as a conclusion.

The status is a disclosure rule, not a statistical confidence interval. Confidence intervals,
calibration analysis, and model-to-model comparisons are deferred until a separate reviewed
contract.

## Missingness, provenance, and ordering

- Coverage is calculated per metric, not once for the whole day.
- A paired day with only temperature values contributes only to temperature metrics.
- Collection date, target date, observation date, lead, provider, and location scope remain
  available for drill-down or export.
- Aggregates are ordered by target date and grouped by lead; they are never ordered by insertion
  time as a substitute for weather date.
- The read model must not expose service-role data across users. User-facing results remain scoped
  by the existing location ownership RLS boundary.
- The current demo view stays explicitly demo-labelled until Stage 9 replaces it with real
  read-model data.

## Stage 8.1 acceptance gates

Stage 8.1 may start after review of this contract and must demonstrate, with fixtures:

1. exact target-date and lead pairing;
2. no cross-location or cross-lead aggregation;
3. null exclusion and per-metric coverage;
4. correct MAE and signed bias;
5. correct TP/FP/FN/TN, precision, recall, and false-alarm rate;
6. null denominators and the sample-size status boundaries;
7. RLS-scoped results and explicit provenance fields.

Production Cron acceptance for Stages 5.3 and 7.2 remains an independent operational gate. This
contract does not authorize a migration, deployment, collector invocation, or production query.
