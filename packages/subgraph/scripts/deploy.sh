#!/usr/bin/env bash
set -o errexit

yarn build:$NETWORK

if [[ -z $VERSION_LABEL ]]; then
  echo 'Please make sure a version label is provided (VERSION_LABEL)'
  exit 1
fi
if [[ -z $GRAPH_KEY ]]; then
  echo 'Please make sure a deploy key is provided (GRAPH_KEY)'
  exit 1
fi
if [[ -z $NETWORK ]]; then
  echo 'Please make sure NETWORK is provided (e.g. base | mainnet)'
  exit 1
fi

NAME=aave-rates-$NETWORK

echo "Deploying $NAME to subgraph studio (version: $VERSION_LABEL)"
yarn graph deploy $NAME --studio --deploy-key "$GRAPH_KEY" -l "$VERSION_LABEL"

if [ $? -ne 0 ]; then
  echo "Error trying to deploy subgraph with exit status $?"
  exit $?
fi
