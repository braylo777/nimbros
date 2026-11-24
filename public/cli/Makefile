# NimBros CLI (C++). Needs a C++17 compiler and libcurl.
#   make            build ./nimbros
#   make check      build and run the built-in crypto self-test
CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra

nimbros: nimbros.cpp
	$(CXX) $(CXXFLAGS) nimbros.cpp -lcurl -o nimbros

check: nimbros
	./nimbros selftest

.PHONY: check
