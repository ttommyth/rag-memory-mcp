# Custom PostgreSQL image with pgvector extension
FROM postgres:15

# Install dependencies for building pgvector
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    postgresql-server-dev-15 \
    && rm -rf /var/lib/apt/lists/*

# Clone and build pgvector
RUN git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git /tmp/pgvector && \
    cd /tmp/pgvector && \
    make && \
    make install && \
    rm -rf /tmp/pgvector

# Copy custom configuration
COPY config/postgresql.conf /etc/postgresql/postgresql.conf

# Set environment variables
ENV POSTGRES_DB=rag_memory
ENV POSTGRES_USER=rag_user
ENV POSTGRES_PASSWORD=rag_secure_password

# Expose PostgreSQL port
EXPOSE 5432

# Use the default PostgreSQL entrypoint
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
