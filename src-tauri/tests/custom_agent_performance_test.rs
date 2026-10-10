use skill_zoo_lib::{config, services::skill::SkillService};
use std::time::Instant;

fn samples(mut work: impl FnMut()) -> (f64, f64) {
    work();
    let mut times = Vec::new();
    for _ in 0..7 {
        let start = Instant::now();
        work();
        times.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    (times[3], times[6])
}

#[test]
#[ignore = "production-path performance evidence; run explicitly"]
fn custom_agent_performance() {
    for n in [100, 1000] {
        for customs in if std::env::var_os("SKILL_ZOO_BENCH_ZERO_ONLY").is_some() {
            vec![0]
        } else {
            vec![0, 5, 20]
        } {
            for populated in if customs == 0 {
                vec![false]
            } else {
                vec![false, true]
            } {
                let temp = tempfile::tempdir().unwrap();
                let root = temp.path().canonicalize().unwrap();
                let mut snapshot = config::AGENTS.clone();
                let mut custom_roots = Vec::new();
                for j in 0..customs {
                    let path = root.join(format!("tool-{j}/skills"));
                    std::fs::create_dir_all(&path).unwrap();
                    let id = format!("custom-00000000-0000-4000-a000-{j:012}");
                    snapshot.push(config::AgentConfig {
                        id: id.clone(),
                        label: format!("Tool {j}"),
                        skills_subdir: String::new(),
                        skills_dir: Some(path.clone()),
                        has_usage_tracking: false,
                    });
                    custom_roots.push((path, id));
                }
                let mut inputs = Vec::new();
                for i in 0..n {
                    let scan_root = if populated {
                        custom_roots[i % customs].0.clone()
                    } else {
                        root.clone()
                    };
                    let agent_id = if populated {
                        Some(custom_roots[i % customs].1.clone())
                    } else {
                        None
                    };
                    let dir = scan_root.join(format!("szoo-bench-{i}"));
                    std::fs::create_dir(&dir).unwrap();
                    std::fs::write(
                        dir.join("SKILL.md"),
                        "---\nname: Fixture\ndescription: Performance fixture\n---\nBody",
                    )
                    .unwrap();
                    inputs.push((dir, scan_root, agent_id));
                }
                config::with_agent_snapshot(std::sync::Arc::new(snapshot), || {
                    let scan = samples(|| {
                        std::hint::black_box(
                            SkillService::scan_skill_roots_batch(&inputs).unwrap(),
                        );
                    });
                    let incremental = samples(|| {
                        std::hint::black_box(
                            SkillService::scan_skill_roots_batch(&inputs[..1]).unwrap(),
                        );
                    });
                    let detect = samples(|| {
                        for (dir, _, _) in &inputs {
                            std::hint::black_box(SkillService::detect_agents(
                                "szoo-bench-skill",
                                &Some(dir.to_string_lossy().into()),
                            ));
                        }
                    });
                    let lookup = samples(|| {
                        for _ in 0..10000 {
                            std::hint::black_box(config::get_agent_skills_dir("codex"));
                        }
                    });
                    println!("BENCH skills={n} customs={customs} populated={populated} scan={scan:?} incremental={incremental:?} detect={detect:?} lookup10000={lookup:?}");
                });
            }
        }
    }
}
