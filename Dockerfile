FROM node:latest
WORKDIR /code
COPY . .
RUN npm i
RUN ls
EXPOSE 5000
CMD ["npm", "start"]
