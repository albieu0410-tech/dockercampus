FROM codercom/code-server:latest

USER root

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    git \
    curl \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages \
    pandas \
    numpy \
    requests \
    fastapi \
    uvicorn \
    sqlalchemy \
    jupyter

USER coder

RUN mkdir -p /home/coder/workspace

WORKDIR /home/coder/workspace

EXPOSE 8080

CMD ["code-server", "--auth", "none", "--bind-addr", "0.0.0.0:8080", "/home/coder/workspace"]