import argparse
import json
from pathlib import Path

from .scenarios import SCENARIOS, generate, load_profile, write_fixtures
from .workflow import run


def main():
    parser = argparse.ArgumentParser(description="Peak State offline workflow demo")
    sub = parser.add_subparsers(dest="command", required=True)
    generate_parser = sub.add_parser("generate", help="Write reproducible synthetic fixture files")
    generate_parser.add_argument("--output", default="examples/synthetic")
    run_parser = sub.add_parser("run", help="Replay a scenario or JSON fixture")
    run_parser.add_argument("--scenario", choices=SCENARIOS, default="recovery")
    run_parser.add_argument("--input", type=Path)
    run_parser.add_argument("--output", type=Path)
    serve_parser = sub.add_parser("serve", help="Start the interactive localhost demo")
    serve_parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.command == "generate":
        write_fixtures(args.output)
        print(f"Wrote {len(SCENARIOS)} synthetic scenarios to {args.output}")
    elif args.command == "serve":
        from .server import serve
        serve(args.port)
    else:
        if args.input:
            payload = json.loads(args.input.read_text(encoding="utf-8"))
            result = run(payload["profile"], payload["inputs"], payload.get("config"))
        else:
            result = run(load_profile(), generate(args.scenario))
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print("SYNTHETIC REPLAY · local policies · no Oura or LLM connection")
        for event in result["events"]:
            print(f"{event['at']}  {event['component']}: {event['kind']}  {event['message']}")
        print(f"Final state: {result['state']} | episodes: {result['episodes']}")


if __name__ == "__main__":
    main()
