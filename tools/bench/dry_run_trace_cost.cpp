#include <chrono>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <random>
#include <vector>
using namespace std;

int main() {
    const int n = 1000000, q = 100000;
    vector<int> a(n);
    for (int i = 0; i < n; ++i) a[i] = 2 * i;
    mt19937 rng(1);
    vector<int> qs(q);
    for (int i = 0; i < q; ++i) qs[i] = rng() % (2u * n);

    ofstream devnull("/dev/null");
    for (int trace = 0; trace < 2; ++trace) {
        auto t0 = chrono::steady_clock::now();
        long long total = 0;
        for (int x : qs) {
            int lo = 0, hi = n, step = 0;
            while (lo < hi) {
                int mid = lo + (hi - lo) / 2;
                if (trace)
                    devnull << "step=" << step << " lo=" << lo << " hi=" << hi
                            << " width=" << hi - lo << " mid=" << mid
                            << " a[mid]=" << a[mid] << "\n";
                if (a[mid] >= x) hi = mid; else lo = mid + 1;
                step += 1;
            }
            total += lo;
        }
        auto t1 = chrono::steady_clock::now();
        double sec = chrono::duration<double>(t1 - t0).count();
        printf("cpp %s = %.3fs (checksum %lld)\n", trace ? "traced" : "silent", sec, total);
    }
    return 0;
}
