# Weather API catalog

Status: research catalog, not an implementation authorization.

Last reviewed: 2026-09-16.

The word “free” below means that a developer can usually start without a payment. It does not
automatically mean that the data may be used in a paid product, redistributed, cached forever, or
used to rank other providers. Re-check the provider terms before adding revenue, advertising, or
public raw-data downloads.

## First benchmark shortlist

These are the most practical first candidates:

1. **Open-Meteo** — already integrated; global forecast models, no key for non-commercial use,
   CC BY attribution, free-use limits. Good baseline, but commercial use and some archive APIs
   require a paid licence.
2. **MET Norway** — global Locationforecast plus global Frost observations; data are freely
   available under a Creative Commons licence including commercial use, subject to service terms
   and attribution. Good independent provider candidate.
3. **OpenWeather** — global current and forecast API with a free allowance and API key; review
   the product-specific licence before using it in a public provider ranking.
4. **WeatherAPI.com** — global forecast/current/history API with a free account tier; confirm
   current quota, attribution, caching, and comparison rights before implementation.
5. **Weatherbit** — free daily/current tier, explicitly marked non-commercial; useful for a
   non-commercial experiment only unless a commercial plan is later purchased.

The first experiment should use one fixed set of coordinates, one observation baseline, and two
providers at most. Adding more names before the measurement contract is stable will create noise,
not a better ranking.

## Forecast sources and APIs

| Candidate | Coverage / data | Access | Initial status | Main caution |
| --- | --- | --- | --- | --- |
| [Open-Meteo](https://open-meteo.com/en/docs) | Global forecasts; many upstream models | No key for free non-commercial use | Already used | Free tier is non-commercial; attribution and rate limits apply |
| [MET Norway Locationforecast](https://api.met.no/weatherapi/locationforecast/2.0/documentation) | Global point forecasts | Free API; User-Agent required | Strong candidate | Follow service conditions and attribution |
| [MET Norway Frost](https://frost.met.no/index.html) | Global observations where available | Free registration/token | Observation baseline candidate | Station coverage and missing data vary |
| [OpenWeather](https://openweathermap.org/api) | Global current, 5-day forecast, other products | API key; free allowance | Strong candidate | Product licence and attribution must be recorded |
| [WeatherAPI.com](https://www.weatherapi.com/docs/) | Global current, forecast, history | API key; free account | Candidate | Verify free quota and redistribution/comparison terms |
| [Weatherbit](https://www.weatherbit.io/api) | Current and daily forecast | API key; free tier | Non-commercial candidate | Free plan is explicitly non-commercial and limited to 50 requests/day |
| [Visual Crossing](https://www.visualcrossing.com/weather-data-pricing/) | Global forecast and historical data | API key; free plan | Candidate | Free plan has records/day limits; verify licence for public ranking |
| [AEMET OpenData](https://opendata.aemet.es/centrodedescargas/inicio) | Spain forecasts and observations | Free API key | Regional candidate | Primarily useful for Spain; terms and quota apply |
| [Météo-France API](https://portail-api.meteofrance.fr/) | France forecasts and observations | Account/API access | Regional candidate | Validate free quota and licence before use |
| [SMHI Open Data](https://www.smhi.se/en/services/open-data) | Sweden forecasts, history, observations | Open APIs | Regional candidate | Best geographic value is Scandinavia; inspect dataset terms |
| [FMI Open Data](https://en.ilmatieteenlaitos.fi/open-data) | Finland forecasts and observations | Open APIs | Regional candidate | Inspect attribution and service limits |
| [KNMI Data Platform](https://dataplatform.knmi.nl/en/) | Netherlands/Europe model and observation datasets | Open Data API; some datasets need access token | Regional candidate | Many products are GRIB rather than simple JSON point forecasts |
| [DWD Open Data](https://opendata.dwd.de/weather/) | German/European model, local forecasts, observations | Public open-data endpoints | Technical candidate | Usually requires GRIB/BUFR processing and careful licence handling |
| [Environment Canada MSC GeoMet](https://eccc-msc.github.io/open-data/msc-geomet/) | Canadian forecasts, observations, model data | Open geospatial APIs | Regional candidate | Mainly Canada; OGC workflows are more complex than JSON APIs |
| [NOAA/NWS API](https://www.weather.gov/documentation/services-web-api) | US forecasts, alerts, observations | Public API | Strong open-data candidate | Geographic coverage is mainly the United States |
| [NOAA NCEI Web Services](https://www.ncei.noaa.gov/support/access-data-service-api-user-documentation) | Historical observations and climate data | Public API | Observation candidate | Not a consumer forecast provider |

## Observation and historical-data sources

These should normally be used as the verification baseline, not ranked as forecast providers:

| Candidate | What it provides | Use in our project |
| --- | --- | --- |
| [Meteostat](https://dev.meteostat.net/) | Historical station observations and station metadata | Candidate for a transparent station-based baseline |
| [NOAA NCEI](https://www.ncei.noaa.gov/) | Government climate and station archives | High-trust baseline where coverage exists |
| [MET Norway Frost](https://frost.met.no/index.html) | Station observations | Candidate for locations covered by its stations |
| [SMHI observations](https://opendata-download-metobs.smhi.se/) | Swedish station observations | Regional verification source |
| [DWD CDC](https://opendata.dwd.de/climate_environment/CDC/) | German station/climate observations | Regional verification source |
| [Open-Meteo Historical Weather](https://open-meteo.com/en/docs/historical-weather-api) | Reanalysis and model-based historical weather | Useful fallback, but not equivalent to a nearby station |

## What not to compare blindly

- Two branded apps may expose the same upstream numerical model with different post-processing.
- An API's “historical weather” may be reanalysis, not the observation that was available at the
  target location on that day.
- A current forecast endpoint usually cannot reconstruct what the provider predicted last week;
  it needs an archive of dated runs or a dedicated previous-runs service.
- A free trial is not the same as a free commercial licence.
- Raw forecasts should not be republished until the provider's terms explicitly permit storage,
  derivative scores, attribution, and public comparison.

## Required provider record

Before enabling a provider in the benchmark, record:

- provider and exact product/model name;
- endpoint, API version, and access date;
- quota, key requirements, and rate limits;
- licence, attribution text, commercial-use status, and caching rules;
- coordinate resolution and timezone behaviour;
- forecast issue timestamp and available lead horizons;
- observation baseline and matching window;
- variables, units, missing-data policy, and calculation version.

## Recommended no-cost sequence

1. Keep the current Open-Meteo collector running in production.
2. Add MET Norway as the first independent development candidate.
3. Add OpenWeather or WeatherAPI.com only after their terms are recorded.
4. Use a separate shared-benchmark schema; never mix it with personal forecast rows.
5. Collect forward for a fixed set of Ukrainian cities while remaining non-commercial.
6. Decide on monetisation only after usage is demonstrated and data licences are confirmed.

