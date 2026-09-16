import test from "node:test";
import assert from "node:assert/strict";

const SAMPLE_SIZE = Object.freeze({ insufficientMax: 9, provisionalMax: 29, reliableMin: 30 });
const RAIN_THRESHOLD_MM = 1;
const RAIN_PROBABILITY_THRESHOLD = 50;

function sampleSizeStatus(n) {
  if (n < 10) return "insufficient";
  if (n < SAMPLE_SIZE.reliableMin) return "provisional";
  return "reliable";
}

function numericMetrics(forecast, observed) {
  const pairs = forecast
    .map((value, index) => [value, observed[index]])
    .filter(([prediction, actual]) => Number.isFinite(prediction) && Number.isFinite(actual));
  if (pairs.length === 0) return { n: 0, mae: null, bias: null };
  const errors = pairs.map(([prediction, actual]) => prediction - actual);
  return {
    n: pairs.length,
    mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / pairs.length,
    bias: errors.reduce((sum, error) => sum + error, 0) / pairs.length,
  };
}

function eventMetrics(probabilities, observedPrecipitation) {
  const counts = { tp: 0, fp: 0, fn: 0, tn: 0 };
  probabilities.forEach((probability, index) => {
    const observed = observedPrecipitation[index];
    if (!Number.isFinite(probability) || !Number.isFinite(observed)) return;
    const predictedEvent = probability >= RAIN_PROBABILITY_THRESHOLD;
    const actualEvent = observed >= RAIN_THRESHOLD_MM;
    const key = predictedEvent && actualEvent ? "tp" : predictedEvent ? "fp" : actualEvent ? "fn" : "tn";
    counts[key] += 1;
  });
  const { tp, fp, fn, tn } = counts;
  return {
    ...counts,
    n: tp + fp + fn + tn,
    precision: tp + fp === 0 ? null : tp / (tp + fp),
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    falseAlarmRate: fp + tn === 0 ? null : fp / (fp + tn),
  };
}

test("numeric accuracy uses paired non-null values and signed forecast-minus-observed error", () => {
  assert.deepEqual(numericMetrics([10, 20, null, 15], [8, 25, 12, NaN]), {
    n: 2,
    mae: 3.5,
    bias: -1.5,
  });
});

test("rain events use 1 mm actual and 50 percent predicted thresholds", () => {
  assert.deepEqual(eventMetrics([50, 49, 80, 20, null], [1, 1, 0, 0, 4]), {
    tp: 1,
    fp: 1,
    fn: 1,
    tn: 1,
    n: 4,
    precision: 0.5,
    recall: 0.5,
    falseAlarmRate: 0.5,
  });
});

test("zero denominators are null, never zero percent", () => {
  assert.deepEqual(eventMetrics([10, 20], [0, 0]), {
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 2,
    n: 2,
    precision: null,
    recall: null,
    falseAlarmRate: 0,
  });
});

test("sample-size status has explicit boundaries", () => {
  assert.equal(sampleSizeStatus(0), "insufficient");
  assert.equal(sampleSizeStatus(SAMPLE_SIZE.insufficientMax), "insufficient");
  assert.equal(sampleSizeStatus(10), "provisional");
  assert.equal(sampleSizeStatus(SAMPLE_SIZE.provisionalMax), "provisional");
  assert.equal(sampleSizeStatus(SAMPLE_SIZE.reliableMin), "reliable");
});
