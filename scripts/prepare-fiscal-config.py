#!/usr/bin/env python3
"""Prepare one owner-only Fiscal configuration without printing/storing a password."""
import argparse
import getpass
import hashlib
import json
import secrets

BASES = ('ASSÚ', 'CAICÓ', 'CARAÚBAS', 'CURRAIS NOVOS', 'MOSSORÓ', 'PAU DOS FERROS')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--user', required=True)
parser.add_argument('--bases', required=True, nargs='+', choices=BASES)
args = parser.parse_args()
if not args.user.strip() or len(args.user.strip()) > 120:
    parser.error('Informe um nome de até 120 caracteres.')
password = getpass.getpass('Senha individual do Fiscal (mínimo 12 caracteres): ')
if len(password) < 12:
    parser.error('Use pelo menos 12 caracteres.')
if password != getpass.getpass('Repita a senha: '):
    parser.error('As senhas não correspondem.')
salt = secrets.token_hex(32)
configuration = {'user': args.user.strip(), 'bases': list(dict.fromkeys(args.bases)), 'salt': salt, 'passwordHash': hashlib.sha256((salt + '\n' + password).encode('utf8')).hexdigest(), 'active': True}
password = None
print(json.dumps(configuration, ensure_ascii=False, indent=2))
