//! The `chimera` binary end to end: a render writes a sound of the planned length, and the
//! calibrations reproduce the tables the engine embeds.

use chimera::math::js_round;
use chimera::phonetics::ipa::tokenize_ipa;
use chimera::phonetics::planner::{PlanOptions, plan_utterance};
use std::process::Command;

const PHONETICS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../chimera/src/phonetics");

fn chimera(args: &[&str]) -> String {
    let out = Command::new(env!("CARGO_BIN_EXE_chimera"))
        .args(args)
        .output()
        .expect("run chimera");
    assert!(
        out.status.success(),
        "chimera {args:?} failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn tmp(name: &str) -> String {
    format!("{}/{name}", env!("CARGO_TARGET_TMPDIR"))
}

#[test]
fn render_speech_writes_a_sounding_wav_of_the_planned_length() {
    let stem = tmp("hello");
    let stdout = chimera(&["render", "speech", &stem, "ˈhɛloʊ"]);
    assert!(
        stdout.starts_with(&format!("wrote {stem}.wav  1.10 s  peak ")),
        "{stdout}"
    );

    let b = std::fs::read(format!("{stem}.wav")).unwrap();
    assert_eq!(&b[0..4], b"RIFF");
    assert_eq!(&b[8..16], b"WAVEfmt ");
    let u16_at = |i: usize| u16::from_le_bytes([b[i], b[i + 1]]);
    let u32_at = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
    assert_eq!(
        (u16_at(20), u16_at(22), u32_at(24), u16_at(34)),
        (1, 1, 48000, 16),
        "16-bit PCM mono 48 kHz"
    );
    let samples: Vec<i16> = b[44..]
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    assert_eq!(u32_at(40) as usize, samples.len() * 2);

    // the tool renders until 0.35 s + 0.2 s after the plan's end (TS wrote 52 692 samples)
    let plan = plan_utterance(
        &tokenize_ipa("ˈhɛloʊ"),
        &PlanOptions {
            body: "male".into(),
            t0: 0.05,
            f0: Some(110.0),
            ..Default::default()
        },
    );
    let expected = js_round(48000.0 * (plan.end + 0.35 + 0.2)) as usize;
    assert_eq!(samples.len(), expected);
    assert_eq!(samples.len(), 52692);

    let peak = samples.iter().map(|s| s.unsigned_abs()).max().unwrap();
    assert!(peak > 3000, "peak {peak}");
    let loud = samples.iter().filter(|s| s.unsigned_abs() > 300).count();
    assert!(
        loud > samples.len() / 10,
        "only {loud} of {} samples above −40 dB",
        samples.len()
    );
}

#[test]
fn calibrate_consonants_reproduces_the_committed_table() {
    let out = tmp("consonantTargets.json");
    chimera(&["calibrate", "consonants", "--out", &out]);
    let got = std::fs::read_to_string(&out).unwrap();
    let want =
        std::fs::read_to_string(format!("{PHONETICS}/consonantTargets.generated.json")).unwrap();
    assert!(
        got == want,
        "calibrate consonants differs from the committed table"
    );
}

/// About 100 s in release. Not byte-identical: the Nelder–Mead fit runs 1 800 + 2 × 1 000
/// iterations on a flat minimum, which amplifies last-ulp differences between V8's libm and Rust's
/// (in the airway geometry and the transfer function) into ~1e-4 changes of the fitted posture.
/// Three entries round the other way at the third decimal: male /ə/ root, child /u/ lipAp (the TS
/// tool gives the committed values), and female /a/ (the TS tool at the port's base commit does
/// not reproduce its committed values either; Rust gives what TS gives today). Everything else,
/// layout and key order included, is identical.
#[test]
#[ignore = "slow (~100 s): cargo test -p chimera-cli --release -- --ignored"]
fn calibrate_vowels_reproduces_the_committed_table() {
    let out = tmp("vowelTargets.json");
    let _ = std::fs::remove_file(&out);
    chimera(&["calibrate", "vowels", "all", "--out", &out]);
    let got = std::fs::read_to_string(&out).unwrap();
    let want = std::fs::read_to_string(format!("{PHONETICS}/vowelTargets.generated.json")).unwrap();
    let (g, w): (Vec<&str>, Vec<&str>) = (got.lines().collect(), want.lines().collect());
    assert_eq!(g.len(), w.len(), "line count");
    let mut differing = Vec::new();
    for (i, (a, b)) in g.iter().zip(&w).enumerate() {
        if a == b {
            continue;
        }
        // only a posture value may differ, and only in the last digit or two
        let split = |l: &str| -> (String, f64) {
            let (k, v) = l
                .trim()
                .trim_end_matches(',')
                .split_once(": ")
                .unwrap_or_else(|| panic!("line {}: {a:?} vs {b:?}", i + 1));
            (
                k.to_string(),
                v.parse()
                    .unwrap_or_else(|_| panic!("line {}: {a:?} vs {b:?}", i + 1)),
            )
        };
        let ((ka, va), (kb, vb)) = (split(a), split(b));
        assert_eq!(ka, kb, "line {}", i + 1);
        assert!(
            [
                "\"tbX\"",
                "\"tbY\"",
                "\"jaw\"",
                "\"lipAp\"",
                "\"lipProt\"",
                "\"lipWidth\"",
                "\"root\"",
                "\"larynx\"",
                "\"ttX\"",
                "\"ttY\"",
                "\"ttCurl\""
            ]
            .contains(&ka.as_str()),
            "line {}: {a:?} vs {b:?}",
            i + 1
        );
        assert!((va - vb).abs() <= 0.0025, "line {}: {a:?} vs {b:?}", i + 1);
        differing.push(i + 1);
    }
    assert!(
        differing.len() <= 8,
        "{} posture values differ (lines {differing:?})",
        differing.len()
    );
}

/// A tiny dataset in CSD's layout: two phrases (a gap between) and a melisma, with a stereo
/// 16-bit 44.1 kHz "singer" that is a pure tone at each note's pitch.
fn mini_csd(dir: &str, syllables: [&str; 4]) {
    mini_song(dir, "x01a", syllables, 0.0);
}

/// One song of the tiny dataset; the singer's second harmonic has amplitude `h2` (re the first).
fn mini_song(dir: &str, id: &str, syllables: [&str; 4], h2: f64) {
    let notes = [
        (0.3, 0.8, 69.0),
        (0.8, 1.3, 69.0),
        (1.3, 1.8, 71.0),
        (2.1, 2.7, 72.0),
    ];
    std::fs::create_dir_all(format!("{dir}/english/csv")).unwrap();
    std::fs::create_dir_all(format!("{dir}/english/wav")).unwrap();
    let mut csv = String::from("start,end,pitch,syllable\r\n");
    for ((a, b, m), s) in notes.iter().zip(syllables) {
        csv += &format!("{a:.4},{b:.4},{m},{s}\r\n");
    }
    std::fs::write(format!("{dir}/english/csv/{id}.csv"), csv).unwrap();
    let fs = 44100.0;
    let n = (3.0 * fs) as usize;
    let mut data = Vec::with_capacity(n * 4);
    for i in 0..n {
        let t = i as f64 / fs;
        let v = notes
            .iter()
            .find(|(a, b, _)| t >= *a && t < *b)
            .map_or(0.0, |(_, _, m)| {
                let ph = 2.0 * std::f64::consts::PI * 440.0 * 2f64.powf((m - 69.0) / 12.0) * t;
                0.3 * (ph.sin() + h2 * (2.0 * ph).sin())
            });
        let s = ((v * 32767.0).round() as i16).to_le_bytes();
        data.extend_from_slice(&s);
        data.extend_from_slice(&s);
    }
    let mut b = Vec::new();
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    for v in [1u16, 2] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    b.extend_from_slice(&44100u32.to_le_bytes());
    b.extend_from_slice(&(44100u32 * 4).to_le_bytes());
    for v in [4u16, 16] {
        b.extend_from_slice(&v.to_le_bytes());
    }
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(data.len() as u32).to_le_bytes());
    b.extend_from_slice(&data);
    std::fs::write(format!("{dir}/english/wav/{id}.wav"), b).unwrap();
}

#[test]
fn compare_csd_sings_the_annotation_on_the_recordings_timeline() {
    let dir = tmp("csd-mini");
    let out = tmp("csd-mini-out");
    mini_csd(&dir, ["l_ii", "ii", "d_ou", "m_ai_n"]);
    let stdout = chimera(&[
        "compare", "csd", &dir, &out, "--songs", "x01a", "--jobs", "1",
    ]);
    assert!(stdout.contains("x01a    4 notes"), "{stdout}");

    // the render has the recording's length (3 s at 48 kHz, 16-bit mono)
    let synth = std::fs::metadata(format!("{out}/x01a-synth.wav"))
        .unwrap()
        .len();
    assert_eq!(synth, 44 + 3 * 48000 * 2);

    let report: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(format!("{out}/report.json")).unwrap())
            .unwrap();
    let notes = report["songs"][0]["notes"].as_array().unwrap();
    let ipa: Vec<&str> = notes.iter().map(|n| n["ipa"].as_str().unwrap()).collect();
    assert_eq!(ipa, ["li", "i", "doʊ", "maɪn"]);
    let flag = |k: &str| {
        notes
            .iter()
            .map(|n| n[k].as_bool().unwrap())
            .collect::<Vec<_>>()
    };
    assert_eq!(flag("melisma"), [false, true, false, false]);
    assert_eq!(flag("phraseStart"), [true, false, false, true]);
    // the "singer" is a pure tone on the score, so its pitch error is ~0
    for n in notes {
        let c = n["human"]["cents"].as_f64().unwrap();
        assert!(c.abs() < 3.0, "{n}");
    }
    // the synth sings every note near its pitch
    for n in notes {
        let c = n["synth"]["cents"].as_f64().unwrap();
        assert!(c.abs() < 60.0, "{n}");
    }
    assert!(
        std::fs::read_to_string(format!("{out}/report.md"))
            .unwrap()
            .contains("| measure |")
    );
}

#[test]
fn compare_csd_scores_training_and_held_out_songs_and_judges_a_rerun() {
    // six songs whose singer differs in H1−H2, so that term has a spread; x05a is held out
    let dir = tmp("csd-score");
    let ids = ["x01a", "x02a", "x03a", "x04a", "x05a", "x06a"];
    for (i, id) in ids.iter().enumerate() {
        mini_song(
            &dir,
            id,
            ["l_ii", "ii", "d_ou", "m_ai_n"],
            0.1 + 0.15 * i as f64,
        );
    }
    let songs = ids.join(",");
    let (first, second) = (tmp("csd-score-1"), tmp("csd-score-2"));
    chimera(&[
        "compare", "csd", &dir, &first, "--songs", &songs, "--jobs", "3",
    ]);
    let score: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(format!("{first}/score.json")).unwrap())
            .unwrap();
    let names = |v: &serde_json::Value| -> Vec<String> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        names(&score["train"]["songs"]),
        ["x01a", "x02a", "x03a", "x04a", "x06a"]
    );
    assert_eq!(names(&score["heldout"]["songs"]), ["x05a"]);
    let h1h2 = &score["train"]["terms"][5];
    assert_eq!(h1h2["name"], "H1-H2");
    assert!(h1h2["spread"].as_f64().unwrap() > 0.0, "{h1h2}");
    assert!(score["train"]["score"].is_number(), "{score}");
    assert_eq!(score["train"]["guards"]["notes"], 20);

    // the engine is deterministic: the same build scored again is no change
    let stdout = chimera(&[
        "compare",
        "csd",
        &dir,
        &second,
        "--songs",
        &songs,
        "--jobs",
        "3",
        "--against",
        &format!("{first}/score.json"),
    ]);
    assert!(stdout.contains("NO CLEAR CHANGE"), "{stdout}");
    // a run over other songs can't be judged against it
    let other = Command::new(env!("CARGO_BIN_EXE_chimera"))
        .args([
            "compare",
            "csd",
            &dir,
            &tmp("csd-score-3"),
            "--songs",
            "x01a,x02a,x03a,x04a,x05a",
            "--against",
            &format!("{first}/score.json"),
        ])
        .output()
        .unwrap();
    assert!(!other.status.success());
    assert!(String::from_utf8_lossy(&other.stderr).contains("other songs"));
}

#[test]
fn compare_csd_refuses_an_unmapped_phoneme() {
    let dir = tmp("csd-bad");
    mini_csd(&dir, ["l_ii", "ii", "d_qq", "m_ai_n"]);
    let out = Command::new(env!("CARGO_BIN_EXE_chimera"))
        .args([
            "compare",
            "csd",
            &dir,
            &tmp("csd-bad-out"),
            "--songs",
            "x01a",
        ])
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("unmapped CSD phonemes: qq"));
}

#[test]
fn render_notes_artic_tracks_follow_the_sound_without_changing_it() {
    let melody = tmp("melody.json");
    std::fs::write(
        &melody,
        r#"{"bpm": 120, "t0": 0, "lyrics": "Take my hand", "notes": [[0, 1], [67, 1], [63, 0.5], [60, 1.5]]}"#,
    )
    .unwrap();
    let (plain, tracked, tracks) = (tmp("notes-plain"), tmp("notes-tracked"), tmp("notes-artic.json"));
    chimera(&["render", "notes", &melody, &plain, "female"]);
    let stdout = chimera(&["render", "notes", &melody, &tracked, "female", "--artic", &tracks]);
    let a = std::fs::read(format!("{plain}.wav")).unwrap();
    let b = std::fs::read(format!("{tracked}.wav")).unwrap();
    assert!(a == b, "--artic changed the sound");

    let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&tracks).unwrap()).unwrap();
    assert_eq!(j["rate"], 100);
    let keys: Vec<&str> = j["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
    assert_eq!(keys.len(), 17);
    let frames = j["frames"].as_array().unwrap();
    // one frame at t = 0 and one per 480 samples rendered
    let samples = (a.len() - 44) / 2;
    assert_eq!(frames.len(), 1 + samples.div_ceil(480), "{stdout}");
    assert!(frames.iter().all(|f| f.as_array().unwrap().len() == 17));
    // the lips close for the /m/ of "my" (its note starts at 1 s) and open for its vowel
    let lip = keys.iter().position(|k| *k == "lipAp").unwrap();
    let ap = |i: usize| frames[i][lip].as_f64().unwrap();
    let closed = (85..105).map(ap).fold(f64::MAX, f64::min);
    let open = (105..125).map(ap).fold(f64::MIN, f64::max);
    assert!(closed < 0.1 && open > 0.5, "lipAp closed {closed}, open {open}");
}

#[test]
fn render_notes_sings_a_front_ends_syllables_without_lyrics() {
    // a language front end writes IPA syllables; no lyrics, no pronouncing dictionary
    let melody = tmp("melody-syllables.json");
    let syl = |onset: &[&str], v: &str, coda: &[&str]| {
        let segs = |xs: &[&str]| xs.iter().map(|x| serde_json::json!({ "ipa": x })).collect::<Vec<_>>();
        serde_json::json!({ "text": v, "onset": segs(onset), "nucleus": { "ipa": v }, "coda": segs(coda), "wordEnd": true, "phraseEnd": false })
    };
    let j = serde_json::json!({
        "bpm": 120, "t0": 0, "notes": [[0, 1], [67, 1], [63, 0.5], [60, 1.5]],
        "syllables": [syl(&["t"], "eɪ", &["k"]), syl(&["m"], "aɪ", &[]), syl(&["h"], "æ", &["n", "d"])],
    });
    std::fs::write(&melody, j.to_string()).unwrap();
    let (stem, tracks) = (tmp("notes-syllables"), tmp("notes-syllables-artic.json"));
    let stdout = chimera(&["render", "notes", &melody, &stem, "female", "--artic", &tracks]);
    assert!(stdout.contains("3 notes"), "{stdout}");
    let t: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&tracks).unwrap()).unwrap();
    let keys: Vec<&str> = t["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
    let lip = keys.iter().position(|k| *k == "lipAp").unwrap();
    let ap = |i: usize| t["frames"][i][lip].as_f64().unwrap();
    // the /m/ of the second syllable (its note starts at 1 s) closes the lips, its vowel opens them
    let closed = (85..105).map(ap).fold(f64::MAX, f64::min);
    let open = (105..125).map(ap).fold(f64::MIN, f64::max);
    assert!(closed < 0.1 && open > 0.5, "lipAp closed {closed}, open {open}");
}

#[test]
fn the_cli_reads_russian_lyrics() {
    // The CLI reads lyrics through its own call into the router (on #85, a list of its own): a
    // language missing there is skipped, and the cargo tests on lyrics_to_syllables still pass
    let syl: serde_json::Value = serde_json::from_str(&chimera(&["syllables", "в лесу́ молоко́"])).unwrap();
    let texts: Vec<&str> = syl.as_array().unwrap().iter().map(|s| s["text"].as_str().unwrap()).collect();
    assert_eq!(texts, ["в ле", "су\u{301}", "мо", "ло", "ко\u{301}"]);
    // and a melody with Russian lyrics renders one syllable per note
    let melody = tmp("melody-russian.json");
    let j = serde_json::json!({ "bpm": 120, "lyrics": "молоко́", "notes": [[60, 1], [62, 1], [64, 2]] });
    std::fs::write(&melody, j.to_string()).unwrap();
    let stdout = chimera(&["render", "notes", &melody, &tmp("notes-russian"), "male"]);
    assert!(stdout.contains("3 notes"), "{stdout}");
}

#[test]
fn render_notes_tele_records_the_live_telemetry_without_changing_the_sound() {
    let melody = tmp("tele-melody.json");
    std::fs::write(
        &melody,
        r#"{"bpm": 120, "t0": 0, "lyrics": "Take my hand", "notes": [[0, 1], [67, 1], [63, 0.5], [60, 1.5]]}"#,
    )
    .unwrap();
    let (plain, tracked, tele, tracks) = (tmp("tele-plain"), tmp("tele-tracked"), tmp("voice.tele"), tmp("tele-artic.json"));
    chimera(&["render", "notes", &melody, &plain, "female"]);
    // both recordings at once: each keeps its own cadence
    let stdout = chimera(&["render", "notes", &melody, &tracked, "female", "--tele", &tele, "--artic", &tracks]);
    let a = std::fs::read(format!("{plain}.wav")).unwrap();
    let b = std::fs::read(format!("{tracked}.wav")).unwrap();
    assert!(a == b, "--tele changed the sound");
    let samples = (a.len() - 44) / 2;
    let artic: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&tracks).unwrap()).unwrap();
    assert_eq!(artic["frames"].as_array().unwrap().len(), 1 + samples.div_ceil(480));

    let t = std::fs::read(&tele).unwrap();
    assert_eq!(&t[..4], b"CHTL");
    let u = |i: usize| u32::from_le_bytes(t[4 + 4 * i..8 + 4 * i].try_into().unwrap()) as usize;
    let f = |o: usize| f32::from_le_bytes(t[o..o + 4].try_into().unwrap());
    let (version, rate, hop, frames, len, n_artic, n_ph, n_or, n_scope) = (u(0), u(1), u(2), u(3), u(4), u(5), u(6), u(7), u(8));
    assert_eq!((version, rate, hop, n_artic, n_scope), (1, 48000, 768, 17, 32));
    assert_eq!((f(40), f(44)), (1.0, 0.0), "body mix: female");
    // the female airway at 48 kHz, two times oversampled
    assert_eq!((n_ph, n_or), (15, 16));
    assert_eq!(len, 11 + n_artic + 3 * (n_ph + n_or) + 2 * n_scope);
    // frame 0 before any sound, then one per whole hop
    assert_eq!(frames, 1 + samples / hop, "{stdout}");
    assert_eq!(t.len(), 48 + 4 * frames * len);
    let at = |i: usize, k: usize| f(48 + 4 * (i * len + k));
    // the clock (field 10) is the frame's time
    for i in [0, 1, frames / 2, frames - 1] {
        assert!((at(i, 10) as f64 - (i * hop) as f64 / 48000.0).abs() < 1e-4, "frame {i} clock {}", at(i, 10));
    }
    // silent before the first note (a beat's rest: it starts at 0.5 s), then "Take" voiced on
    // G4 (392 Hz): frames 38-53 are 0.61-0.85 s
    let out_rms = |i: usize| at(i, 6);
    assert!((1..20).all(|i| out_rms(i) < 1e-4), "noise before the first note");
    let sung = 38..54;
    assert!(sung.clone().all(|i| out_rms(i) > 1e-2 && at(i, 4) > 0.5), "not voiced while singing");
    let f0 = sung.map(|i| at(i, 3)).sum::<f32>() / 16.0;
    assert!((f0 - 392.0).abs() < 12.0, "f0 {f0}");
    // the articulators agree with --artic's (lipAp at 1.0 s: artic frame 100, tele frame 62.5)
    let keys: Vec<&str> = artic["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap()).collect();
    let lip = keys.iter().position(|k| *k == "lipAp").unwrap();
    let a_lip = artic["frames"][96][lip].as_f64().unwrap(); // 0.96 s = 60 tele hops
    assert!((at(60, 11 + lip) as f64 - a_lip).abs() < 1e-3, "lipAp {} vs {a_lip}", at(60, 11 + lip));
}

/// 16-bit mono samples of a WAV the CLI wrote.
fn pcm(path: &str) -> Vec<i16> {
    let b = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    b[44..].chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect()
}

/// A `--tele` file's header: (frames, frameLen, hop, body mix), having checked its size.
fn tele_header(path: &str) -> (usize, usize, usize, (f32, f32)) {
    let t = std::fs::read(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    assert_eq!(&t[..4], b"CHTL");
    let u = |i: usize| u32::from_le_bytes(t[4 + 4 * i..8 + 4 * i].try_into().unwrap()) as usize;
    let f = |o: usize| f32::from_le_bytes(t[o..o + 4].try_into().unwrap());
    let (version, rate, hop, frames, len, n_artic, n_ph, n_or, n_scope) = (u(0), u(1), u(2), u(3), u(4), u(5), u(6), u(7), u(8));
    assert_eq!((version, rate, hop, n_artic, n_scope), (1, 48000, 768, 17, 32));
    assert_eq!(len, 11 + n_artic + 3 * (n_ph + n_or) + 2 * n_scope);
    assert_eq!(t.len(), 48 + 4 * frames * len, "{path}: header and size disagree");
    (frames, len, hop, (f(40), f(44)))
}

#[test]
fn render_hits_land_at_their_times_as_the_sequencer_plays_them() {
    // One bar through the sequencer (`render beatbox`: the first step 0.2 s in, sixteenths at
    // 100 bpm), then the same sounds as free hits at those times: a sustained sound lasts until
    // the next one, and the hum's note and the accent carry over. The sequencer loops, so its
    // 1.7 s also hold the start of the bar again (the last of those sets up as the render ends).
    let dir = tmp("hits-seq");
    chimera(&["render", "beatbox", &dir, "B m:43 . t | Pf> . . .", "male", "100", "1"]);
    let step = 60.0 / 100.0 / 4.0;
    let at = |n: usize| 0.2 + n as f64 * step;
    let j = serde_json::json!({ "end": 1.7, "hits": [
        [at(0), "B", step],
        [at(1), "m", 2.0 * step, 43],
        [at(3), "t", step],
        [at(4), "Pf", 4.0 * step, null, 1.3],
        [at(8), "B", step],
        [at(9), "m", 2.0 * step, 43],
        [at(11), "t", step],
    ] });
    let (input, stem) = (tmp("hits.json"), tmp("hits"));
    std::fs::write(&input, j.to_string()).unwrap();
    let stdout = chimera(&["render", "hits", &input, &stem]);
    assert!(stdout.starts_with(&format!("wrote {stem}.wav  1.70 s  peak ")) && stdout.contains("7 hits"), "{stdout}");
    let (seq, free) = (pcm(&format!("{dir}/pattern.wav")), pcm(&format!("{stem}.wav")));
    assert_eq!(free.len(), 81600);
    assert!(seq == free, "free hits differ from the sequencer's steps");

    // and the kick and the snare start at their times: the first sample from 40 ms before the
    // hit to reach a quarter of the hit's peak is within 15 ms of it (the snare's burst leads by
    // 10; the hi-hat has no onset to find here, it follows the hum)
    let s = |t: f64| (t * 48000.0).round() as usize;
    let abs = |i: usize| free[i].unsigned_abs();
    for (n, id) in [(0, "B"), (4, "Pf")] {
        let t = at(n);
        let peak = (s(t - 0.03)..s(t + 0.08)).map(abs).max().unwrap();
        assert!(peak > 1500, "{id} at {t}: peak {peak}");
        let onset = (s(t - 0.04)..s(t + 0.08)).find(|i| abs(*i) > peak / 4).unwrap();
        let early_ms = (onset as f64 / 48000.0 - t) * 1000.0;
        assert!(early_ms.abs() < 15.0, "{id} at {t}: onset {early_ms} ms off");
    }
}

#[test]
fn render_hits_refuses_an_unknown_sound_and_a_hit_with_no_room_to_set_up() {
    let fails = |name: &str, j: serde_json::Value| -> String {
        let input = tmp(name);
        std::fs::write(&input, j.to_string()).unwrap();
        let out = Command::new(env!("CARGO_BIN_EXE_chimera")).args(["render", "hits", &input, &tmp("hits-refused")]).output().unwrap();
        assert!(!out.status.success(), "{name} rendered");
        String::from_utf8_lossy(&out.stderr).into_owned()
    };
    // a sound the kit lacks is an error, not a silent gap in the beat
    let err = fails("hits-unknown.json", serde_json::json!({ "end": 1, "hits": [[0.3, "B"], [0.6, "zz"]] }));
    assert!(err.contains("hit 1: unknown beat sound \"zz\"") && err.contains("have B t tss"), "{err}");
    // the notation's own spelling is one id; its accent mark is not part of it
    let err = fails("hits-accent.json", serde_json::json!({ "end": 1, "hits": [[0.3, "B>"]] }));
    assert!(err.contains("unknown beat sound \"B>\""), "{err}");
    // the lip pop starts 173 ms before it is heard
    let err = fails("hits-early.json", serde_json::json!({ "end": 1, "hits": [[0.05, "P!"]] }));
    assert!(err.contains("hit 0: P! needs 0.173 s of set-up"), "{err}");
    let err = fails("hits-no-end.json", serde_json::json!({ "hits": [[0.3, "B"]] }));
    assert!(err.contains("\"end\" (seconds) missing"), "{err}");
}

#[test]
fn render_text_and_hits_tele_frame_the_whole_render_without_changing_the_sound() {
    // speech: `render text --tele`
    let (plain, tracked, tele) = (tmp("say-plain"), tmp("say-tracked"), tmp("say.tele"));
    chimera(&["render", "text", &plain, "Good morning.", "female"]);
    let stdout = chimera(&["render", "text", &tracked, "Good morning.", "female", "--tele", &tele]);
    let a = std::fs::read(format!("{plain}.wav")).unwrap();
    assert!(a == std::fs::read(format!("{tracked}.wav")).unwrap(), "--tele changed the speech");
    let samples = (a.len() - 44) / 2;
    let (frames, len, hop, mix) = tele_header(&tele);
    // frame 0 before any sound, then one per whole hop of the render
    assert_eq!(frames, 1 + samples / hop, "{stdout}");
    assert!(stdout.contains(&format!("{tele}: {frames} telemetry frames every 768 samples")), "{stdout}");
    assert_eq!(mix, (1.0, 0.0), "body mix: female");
    let t = std::fs::read(&tele).unwrap();
    let at = |i: usize, k: usize| f32::from_le_bytes(t[48 + 4 * (i * len + k)..52 + 4 * (i * len + k)].try_into().unwrap());
    assert!((at(frames - 1, 10) as f64 - ((frames - 1) * hop) as f64 / 48000.0).abs() < 1e-4, "the last frame's clock");
    // the voice speaks: some frame is loud and voiced near the speaking pitch (205 Hz)
    assert!((0..frames).any(|i| at(i, 6) > 1e-2 && at(i, 4) > 0.5 && (at(i, 3) - 205.0).abs() < 60.0), "no voiced frame");

    // beat sounds: `render hits --tele`, the flag anywhere among the arguments
    let input = tmp("hits-tele.json");
    std::fs::write(&input, serde_json::json!({ "end": 1.25, "hits": [[0.5, "B"], [0.9, "t"]] }).to_string()).unwrap();
    let (plain, tracked, tele) = (tmp("hits-plain"), tmp("hits-tracked"), tmp("hits.tele"));
    chimera(&["render", "hits", &input, &plain]);
    let stdout = chimera(&["render", "hits", "--tele", &tele, &input, &tracked]);
    let a = pcm(&format!("{plain}.wav"));
    assert!(a == pcm(&format!("{tracked}.wav")), "--tele changed the beat");
    assert_eq!(a.len(), 60000, "1.25 s");
    let (frames, len, hop, mix) = tele_header(&tele);
    assert_eq!(frames, 1 + 60000 / hop, "{stdout}");
    assert_eq!(frames, 79);
    assert_eq!(mix, (0.0, 0.0), "body mix: male");
    let t = std::fs::read(&tele).unwrap();
    let at = |i: usize, k: usize| f32::from_le_bytes(t[48 + 4 * (i * len + k)..52 + 4 * (i * len + k)].try_into().unwrap());
    // the kick is in the frames after 0.5 s (frame 32 covers 0.496–0.512 s), silence before it
    let out_rms = |i: usize| at(i, 6);
    assert!((1..20).all(|i| out_rms(i) < 1e-3), "noise before the kick sets up");
    let kick = (31..35).map(out_rms).fold(0f32, f32::max);
    assert!(kick > 1e-2, "kick rms {kick}");
    // and the lips shut for the kick's build-up (lipAp: articulator 7)
    let lip = 11 + 7;
    let shut = (24..32).map(|i| at(i, lip)).fold(f32::MAX, f32::min);
    assert!(shut < 0.05, "lips never shut before the kick: {shut}");
}
