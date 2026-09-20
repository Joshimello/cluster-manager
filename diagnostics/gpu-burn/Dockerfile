ARG CUDA_VERSION=12.8.1

FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu24.04 AS builder
ARG GPU_BURN_COMMIT=3ead140434da9473582b68452f7115967a7a0581
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone https://github.com/wilicc/gpu-burn.git . \
    && git checkout --detach "${GPU_BURN_COMMIT}" \
    && test "$(git rev-parse HEAD)" = "${GPU_BURN_COMMIT}" \
    && make COMPUTE=75

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu24.04
LABEL org.opencontainers.image.source="https://github.com/Joshimello/cluster-manager"
LABEL org.opencontainers.image.licenses="BSD-2-Clause"
COPY --from=builder /src/gpu_burn /opt/gpu-burn/gpu_burn
COPY --from=builder /src/compare.fatbin /opt/gpu-burn/compare.fatbin
COPY --from=builder /src/LICENSE /licenses/gpu-burn-LICENSE
WORKDIR /opt/gpu-burn
ENV CUDA_CACHE_PATH=/tmp/cuda-cache
USER 65534:65534
ENTRYPOINT ["/opt/gpu-burn/gpu_burn"]
CMD ["60"]
