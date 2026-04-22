# Friction verdict thresholds

`get_friction_report` attaches a short plain-language verdict to every
per-target "you vs the network" comparison. This doc explains what each
verdict means and what thresholds produced it.

The math is centralized in
[`src/config/friction-thresholds.ts`](../src/config/friction-thresholds.ts).
The verdict render in `get-friction-report.ts` prints the rule that
fired alongside the verdict line, so you can audit the conclusion
without running a debugger.

## Sample-size floors

A comparative verdict only fires when both sides of the comparison have
enough data to be honest. Below the floors, the report still surfaces
the raw numbers — just without a verdict.

| Side        | Constant                      | Default | Meaning                                                    |
| ----------- | ----------------------------- | ------: | ---------------------------------------------------------- |
| Local       | `LOCAL_MIN_INTERACTIONS`      |    10   | Minimum local interactions with the target before comparing. |
| Network     | `NETWORK_MIN_AGENTS`          |     3   | Minimum distinct agents on the network side.               |
| Network     | `NETWORK_MIN_INTERACTIONS`    |    50   | Minimum total network interactions.                        |

A 1-agent "network" can't outvote you, so the threshold must be crossed
on both axes.

## Verdict bands

Thresholds are evaluated in order. The first matching clause wins.

### 1. "Likely your config/network"

> *Most agents succeed here — you shouldn't be failing this often.*

Fires when **all** of the following are true:

- Network failure rate `< NETWORK_HEALTHY_PCT` (default `5%`).
- Your failure rate `≥ LOCAL_CONFIG_FLOOR_PCT` (default `5%`).
- Your failure rate `> CONFIG_RATIO × network rate` (default `2×`).

The absolute local floor (`5%`) prevents a trivial ratio beat: 1 failure
in 10 interactions is 10%, which beats `2× 0.5% = 1%` without meaning
anything useful. Both the relative *and* absolute conditions must hold.

### 2. "Better than the network"

> *You're doing better than your peers on this target.*

Fires when:

- Your failure rate `> 0` (no divide-by-zero "better" when you have zero failures).
- Network failure rate `> BETTER_RATIO × your rate` (default `2×`).

### 3. "Network-wide issue"

> *This target is failing for many agents — it's not just you.*

Fires when both:

- Your failure rate `≥ NETWORK_WIDE_PCT` (default `20%`).
- Network failure rate `≥ NETWORK_WIDE_PCT` (default `20%`).

### 4. "Consistent with the network"

Default verdict when none of the above clauses fire. Your rate sits
inside the envelope of what peers see.

## How the rendered line reads

Each verdict line prints like:

```
you 7.2% vs network 2.1% → likely your config/network — most agents succeed here
(threshold: net<5% AND yours≥5% AND yours>2×net)
```

The percentages are the inputs; the `threshold` line is the rule that
actually fired. If you disagree with the verdict, the rule expression
tells you exactly which constant to contest.

## Tuning

All thresholds live in `friction-thresholds.ts` as named exports. Any
change here should come with:

1. A unit-test update for the boundary case you're moving.
2. A note in this doc explaining what observation motivated the change.
3. A CHANGELOG entry — operators should be able to see that a verdict
   they relied on shifted.

Do not add a threshold without naming it here. Magic numbers buried
inline in tools are how silent drift in judgment happens.
