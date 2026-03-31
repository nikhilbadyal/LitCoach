FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Copy requirements file from the api folder
COPY api/requirements.txt .

# Install python dependencies securely without caching
RUN pip install --no-cache-dir -r requirements.txt

# Copy the api source code
COPY api/ ./api/

# Expose backend server port
EXPOSE 8000

# Run uvicorn server on container startup
CMD ["uvicorn", "api.app:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
