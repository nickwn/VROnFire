const PORT = 3000;
const express = require('express');
let app = express();

app.use(express.logger());
app.use(express.compress());
app.use(express.static(__dirname + '/'));

// Start the server
const port = process.env.PORT || PORT; // 80 for web, 3000 for development
app.listen(port, function() {
	console.log("Node.js server running on port %s", port);
});