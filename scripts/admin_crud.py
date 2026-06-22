#!/usr/bin/env python3
"""Manage local DockCampus administrator accounts through the Postgres container."""

from __future__ import annotations

import argparse
import secrets
import string
import subprocess
import sys

import bcrypt


DB_CONTAINER = "dockcampus-db"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def run_sql(sql: str, *, capture: bool = False) -> str:
    command = [
        "docker",
        "exec",
        "-i",
        DB_CONTAINER,
        "sh",
        "-lc",
        'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    ]
    result = subprocess.run(
        command,
        input=sql,
        text=True,
        capture_output=capture,
        check=False,
    )
    if result.returncode != 0:
        if capture and result.stderr:
            print(result.stderr, file=sys.stderr, end="")
        raise SystemExit(result.returncode)
    return result.stdout.strip() if capture else ""


def generated_password(length: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def create_admin(args: argparse.Namespace) -> None:
    password = args.password or generated_password()
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    email = args.email.strip().lower()

    run_sql(
        f"""
        INSERT INTO users (
            email, hashed_password, full_name, role, is_active, is_verified
        ) VALUES (
            {sql_literal(email)},
            {sql_literal(password_hash)},
            {sql_literal(args.name.strip())},
            'admin'::user_role,
            true,
            true
        )
        ON CONFLICT (email) DO UPDATE SET
            hashed_password = EXCLUDED.hashed_password,
            full_name = EXCLUDED.full_name,
            role = 'admin'::user_role,
            is_active = true,
            is_verified = true;
        """
    )
    print(f"Admin email: {email}")
    print(f"Admin password: {password}")


def list_admins(_: argparse.Namespace) -> None:
    output = run_sql(
        """
        SELECT email, full_name, is_active, is_verified, created_at
        FROM users
        WHERE role = 'admin'::user_role
        ORDER BY created_at;
        """,
        capture=True,
    )
    print(output)


def update_admin(args: argparse.Namespace) -> None:
    assignments: list[str] = []
    if args.name is not None:
        assignments.append(f"full_name = {sql_literal(args.name.strip())}")
    if args.password is not None:
        password_hash = bcrypt.hashpw(args.password.encode(), bcrypt.gensalt()).decode()
        assignments.append(f"hashed_password = {sql_literal(password_hash)}")
    if args.active is not None:
        assignments.append(f"is_active = {'true' if args.active else 'false'}")
    if not assignments:
        raise SystemExit("Nothing to update. Provide --name, --password, or --active.")

    email = args.email.strip().lower()
    run_sql(
        f"""
        UPDATE users
        SET {', '.join(assignments)}
        WHERE email = {sql_literal(email)} AND role = 'admin'::user_role;
        """
    )
    print(f"Updated admin: {email}")


def delete_admin(args: argparse.Namespace) -> None:
    email = args.email.strip().lower()
    run_sql(
        f"""
        DELETE FROM users
        WHERE email = {sql_literal(email)} AND role = 'admin'::user_role;
        """
    )
    print(f"Deleted admin: {email}")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)

    create = commands.add_parser("create", help="Create or reset an administrator")
    create.add_argument("--email", default="admin@localhost")
    create.add_argument("--name", default="Local Admin")
    create.add_argument("--password", help="Generate a password when omitted")
    create.set_defaults(handler=create_admin)

    listing = commands.add_parser("list", help="List administrators")
    listing.set_defaults(handler=list_admins)

    update = commands.add_parser("update", help="Update an administrator")
    update.add_argument("--email", default="admin@localhost")
    update.add_argument("--name")
    update.add_argument("--password")
    update.add_argument("--active", action=argparse.BooleanOptionalAction)
    update.set_defaults(handler=update_admin)

    delete = commands.add_parser("delete", help="Delete an administrator")
    delete.add_argument("--email", default="admin@localhost")
    delete.set_defaults(handler=delete_admin)
    return root


def main() -> None:
    args = parser().parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
