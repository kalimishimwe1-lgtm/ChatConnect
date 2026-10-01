# Dockerfile for ChatConnect Application

# Use Node.js 20 Alpine as the base image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /ChatConnect

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy application files and directories to the container
COPY db/ db/
COPY auth/ auth/
COPY controller/ controller/
COPY views/ views/
COPY routes/ routes/
COPY services/ services/
COPY public/ public/
COPY app.js app.js
COPY redis/ redis/
COPY socket/ socket/

# Specify the command to run the application
ENTRYPOINT [ "npm", "start" ]