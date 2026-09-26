//! Step timings for the log, one line per operation:
//! `scan vscode: 468 ms (worktrees 2 ms, branches 9 ms, status 4× 440 ms, stats 3× 12 ms)`.

use std::fmt;
use std::time::{Duration, Instant};

pub struct Timings {
    started: Instant,
    steps: Vec<Step>,
}

struct Step {
    label: &'static str,
    total: Duration,
    count: u32,
}

impl Timings {
    pub fn start() -> Self {
        Timings {
            started: Instant::now(),
            steps: Vec::new(),
        }
    }

    /// Runs `f` and adds its duration to `label`.
    pub fn time<T>(&mut self, label: &'static str, f: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let out = f();
        self.add(label, started.elapsed());
        out
    }

    /// Adds a duration to `label`; repeated labels are summed and counted.
    pub fn add(&mut self, label: &'static str, d: Duration) {
        match self.steps.iter_mut().find(|s| s.label == label) {
            Some(s) => {
                s.total += d;
                s.count += 1;
            }
            None => self.steps.push(Step {
                label,
                total: d,
                count: 1,
            }),
        }
    }
}

fn ms(d: Duration) -> String {
    let ms = d.as_secs_f64() * 1000.0;
    if ms < 10.0 {
        format!("{ms:.1} ms")
    } else {
        format!("{ms:.0} ms")
    }
}

impl fmt::Display for Timings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", ms(self.started.elapsed()))?;
        if self.steps.is_empty() {
            return Ok(());
        }
        let steps: Vec<String> = self
            .steps
            .iter()
            .map(|s| match s.count {
                1 => format!("{} {}", s.label, ms(s.total)),
                n => format!("{} {n}× {}", s.label, ms(s.total)),
            })
            .collect();
        write!(f, " ({})", steps.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_and_counts_repeated_steps() {
        let mut t = Timings::start();
        t.add("status", Duration::from_millis(100));
        t.add("status", Duration::from_millis(40));
        t.add("stats", Duration::from_micros(2500));
        let line = t.to_string();
        assert!(line.ends_with("(status 2× 140 ms, stats 2.5 ms)"), "{line}");
    }
}
