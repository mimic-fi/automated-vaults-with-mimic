#!/usr/bin/env bash
set -o errexit


provider_base_aave=0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A
startBlock_base=37570470
# USDC (Base): 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
address_base_aave=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
address_base_compound=0xb125e6687d4313864e53df431d5425969c15eb2f
address_base_morpho=0x7bfa7c4f149e7415b73bdedfe609237e29cbf34a
lagoon_vault_address_base=0xA87eB0c08Bb231F424b97783D3a0966915f080bd

provider_mainnet_aave=0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD
startBlock_mainnet=23471000

address_mainnet_aave=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
address_mainnet_compound=0xc3d688B66703497DAA19211EEdff47f25384cdc3
address_mainnet_morpho=0xba9E3b3b684719F80657af1A19DEbc3C772494a0
lagoon_vault_address_mainnet=0x0bdea94e3403fc554b70d087df00a0257b66cad3

networks=(base mainnet)
if [[ -z $NETWORK || ! " ${networks[@]} " =~ " ${NETWORK} " ]]; then
  echo 'Please make sure the network provided is either: base, mainnet.'
  exit 1
fi

if [[ "$NETWORK" = "localhost" ]]; then
  ENV='mainnet'
else
  ENV=${NETWORK}
fi

PROVIDER_VAR_AAVE="provider_${NETWORK}_aave"
PROVIDER_ADDRESS=${!PROVIDER_VAR_AAVE}

START_VAR="startBlock_${NETWORK}"
START_BLOCK=${!START_VAR}
if [[ -z $START_BLOCK ]]; then
  START_BLOCK=0
fi

AAVE_ASSET_VAR="address_${NETWORK}_aave"
COMPOUND_VAR="address_${NETWORK}_compound"
MORPHO_VAR="address_${NETWORK}_morpho"
LAGOON_VAR="lagoon_vault_address_${NETWORK}"

AAVE_ASSET=${!AAVE_ASSET_VAR}
COMPOUND_ADDRESS=${!COMPOUND_VAR}
MORPHO_ADDRESS=${!MORPHO_VAR}
LAGOON_ADDRESS=${!LAGOON_VAR}

if [[ -z $PROVIDER_ADDRESS ]]; then
  echo "Please set provider_${NETWORK}_aave"
  exit 1
fi
if [[ -z $AAVE_ASSET ]]; then
  echo "Please set address_${NETWORK}_aave"
  exit 1
fi
if [[ -z $COMPOUND_ADDRESS ]]; then
  echo "Please set address_${NETWORK}_compound"
  exit 1
fi
if [[ -z $MORPHO_ADDRESS ]]; then
  echo "Please set address_${NETWORK}_morpho"
  exit 1
fi

if [[ -z $LAGOON_ADDRESS ]]; then
  echo "Please set lagoon_vault_address_${NETWORK}"
  exit 1
fi

rm -f subgraph.yaml
cp subgraph.template.yaml subgraph.yaml
sed -i -e "s/{{network}}/${ENV}/g" subgraph.yaml
sed -i -e "s/{{providerAddress}}/${PROVIDER_ADDRESS}/g" subgraph.yaml
sed -i -e "s/{{startBlock}}/${START_BLOCK}/g" subgraph.yaml
sed -i -e "s/{{aaveAsset}}/${AAVE_ASSET}/g" subgraph.yaml
sed -i -e "s/{{compoundAddress}}/${COMPOUND_ADDRESS}/g" subgraph.yaml
sed -i -e "s/{{morphoVaultAddress}}/${MORPHO_ADDRESS}/g" subgraph.yaml
sed -i -e "s/{{lagoonVaultAddress}}/${LAGOON_ADDRESS}/g" subgraph.yaml
rm -f subgraph.yaml-e

sed -i -e 's|\.\./generated/|\.\./types/|g' src/*.ts || true
sed -i -e 's|\.\./generated/schema|\.\./types/schema|g' src/*.ts || true
rm -f src/*-e

rm -rf ./types
./node_modules/.bin/graph codegen -o types
./node_modules/.bin/graph build

echo "Build completed for ${NETWORK}"