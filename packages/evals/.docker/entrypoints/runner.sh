#!/bin/bash

if [ $# -eq 0 ]; then
    exec bash
else
    exec "$@"
fi
